# Builds the voice model the essay checker runs in the browser, from LUAR-MUD
# (rrivera1849/LUAR-MUD, Apache-2.0; Rivera-Soto et al., "Learning Universal Authorship
# Representations", EMNLP 2021):
#   python scripts/voice/export_luar.py
# Writes models/voice/: tokenizer files and onnx/model.onnx, which maps one "episode" (a text cut
# into pieces of 32 tokens) to a 512-number style vector. MatMuls are 4-bit (blocks of 32) and the
# embedding table is int8 with one scale per row, dequantized with plain Gather/Cast/Mul so every
# ONNX Runtime backend runs it. Needs torch, transformers, einops, onnx, onnxscript, onnxruntime.
import os, shutil
import numpy as np, onnx, torch
from huggingface_hub import snapshot_download
from onnx import helper, numpy_helper, TensorProto
from onnxruntime.quantization.matmul_nbits_quantizer import DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer
from transformers import AutoModel, AutoTokenizer

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'models', 'voice')
REPO, REVISION = 'rrivera1849/LUAR-MUD', 'f1db50251805ed69b43cf4f72ea2f0e231f36a1c'
os.makedirs(os.path.join(OUT, 'onnx'), exist_ok=True)
src = snapshot_download(REPO, revision=REVISION)
for f in ('tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json'):
    shutil.copy(os.path.join(src, f), os.path.join(OUT, f))
tok = AutoTokenizer.from_pretrained(src)
luar = AutoModel.from_pretrained(src, trust_remote_code=True).eval()

class Episode(torch.nn.Module):
    """One episode in, one style vector out: (pieces, 32) token ids -> (512,)."""
    def __init__(self, m):
        super().__init__()
        self.m = m
    def forward(self, input_ids, attention_mask):
        return self.m(input_ids=input_ids.unsqueeze(0), attention_mask=attention_mask.unsqueeze(0))[0]

enc = tok(['A short warm-up text for tracing.', 'Another piece', 'and a third one here'], max_length=32, padding='max_length', truncation=True, return_tensors='pt')
tmp = os.path.join(OUT, 'onnx', 'fp32.onnx')
pieces = torch.export.Dim('pieces', min=1, max=512)
torch.onnx.export(Episode(luar), (), tmp, kwargs={'input_ids': enc['input_ids'], 'attention_mask': enc['attention_mask']},
                  input_names=['input_ids', 'attention_mask'], output_names=['style'],
                  dynamic_shapes={'input_ids': {0: pieces}, 'attention_mask': {0: pieces}}, dynamo=True, external_data=True)
m = onnx.load(tmp)
del m.graph.value_info[:]
cfg = DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True, bits=4, op_types_to_quantize=('MatMul',), quant_axes=(('MatMul', 0),))
q = MatMulNBitsQuantizer(m, algo_config=cfg)
q.process()
m = q.model.model
# The word-embedding table as int8, one scale per row.
inits = {i.name: i for i in m.graph.initializer}
big = [n for n in m.graph.node if n.op_type == 'Gather' and n.input[0] in inits and numpy_helper.to_array(inits[n.input[0]]).ndim == 2 and numpy_helper.to_array(inits[n.input[0]]).shape[0] > 10000]
assert len(big) == 1, [n.name for n in big]
g = big[0]
W = numpy_helper.to_array(inits[g.input[0]]).astype(np.float32)
scale = np.abs(W).max(axis=1, keepdims=True) / 127.0
scale[scale == 0] = 1
q8 = np.clip(np.round(W / scale), -127, 127).astype(np.int8)
name, out = g.input[0], g.output[0]
m.graph.initializer.remove(inits[name])
m.graph.initializer.extend([numpy_helper.from_array(q8, name + '_q8'), numpy_helper.from_array(scale.astype(np.float32), name + '_scale')])
nodes = [helper.make_node('Gather', [name + '_q8', g.input[1]], [out + '_q8'], axis=0),
         helper.make_node('Gather', [name + '_scale', g.input[1]], [out + '_scale'], axis=0),
         helper.make_node('Cast', [out + '_q8'], [out + '_f'], to=TensorProto.FLOAT),
         helper.make_node('Mul', [out + '_f', out + '_scale'], [out])]
i = list(m.graph.node).index(g)
m.graph.node.remove(g)
for k, n in enumerate(nodes):
    m.graph.node.insert(i + k, n)
onnx.save(m, os.path.join(OUT, 'onnx', 'model.onnx'))
for f in os.listdir(os.path.join(OUT, 'onnx')):
    if f.startswith('fp32.onnx'):
        os.remove(os.path.join(OUT, 'onnx', f))
print('wrote', OUT, round(os.path.getsize(os.path.join(OUT, 'onnx', 'model.onnx')) / 1e6, 1), 'MB')
