// Slopgauge detector. Finds AI-writing patterns in two layers, all local (no network, no model):
//   1. Phrase rules: named patterns like binary contrasts, colon reveals and filler phrases.
//      Adapted from petergyang/no-ai-slop (MIT, (c) 2026 Peter Yang).
//   2. Style signals: counts over sentences that a phrase list can't express, like stacked
//      rule-of-three lists, repeated sentence openers and piles of essay transitions.
// Many findings carry an `edit`, a safe mechanical fix the UI can apply in one click.
(function (root) {
  'use strict';

  const AP = "['’]"; // straight or curly apostrophe
  const CLOSERS = '["”’)]';

  function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // "here's the thing" -> case-insensitive regex that tolerates curly quotes and extra spaces.
  function phraseRe(list) {
    const body = list.map((p) => escapeRe(p).replace(/'/g, AP).replace(/ /g, '\\s+')).join('|');
    return new RegExp("(?<![\\w'’])(?:" + body + ')(?!\\w)', 'gi');
  }

  // Sentence start: start of text, start of a line, or after . ! ? and a few spaces.
  // The lookbehind is bounded on purpose: an unbounded one is quadratic on long runs of spaces.
  const START = '(?:^|(?<=[.!?]' + CLOSERS + '?[ \\t]{1,3})|(?<=\\n)[ \\t]*)';

  // ---------- Sentences ----------

  // Split text into sentences with offsets. Breaks after . ! ? followed by whitespace, and at newlines.
  function sentences(text) {
    const out = [];
    let start = 0;
    const push = (s, e) => {
      while (s < e && /\s/.test(text[s])) s++;
      while (e > s && /\s/.test(text[e - 1])) e--;
      if (e <= s) return;
      const body = text.slice(s, e);
      out.push({
        start: s,
        end: e,
        text: body,
        words: (body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length,
        terminal: /[.!?…]["”’)]?$/.test(body),
      });
    };
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '\n') {
        push(start, i);
        start = i + 1;
      } else if (c === '.' || c === '!' || c === '?') {
        let j = i;
        while (j + 1 < text.length && /[.!?]/.test(text[j + 1])) j++;
        if (j + 1 < text.length && /["”’)]/.test(text[j + 1])) j++;
        if (j + 1 < text.length && !/\s/.test(text[j + 1])) continue;
        // Don't split after abbreviations and initials: "e.g.", "Dr.", "J. Smith".
        if (c === '.' && /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|mr|mrs|ms|dr|st|jr|sr|inc|\p{L})$/iu.test(text.slice(Math.max(start, i - 5), i))) {
          i = j;
          continue;
        }
        push(start, j + 1);
        start = j + 1;
        i = j;
      }
    }
    push(start, text.length);
    return out;
  }

  const countWords = (s) => (s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
  const firstWord = (s) => {
    const m = /^[^\p{L}\p{N}]*([\p{L}\p{N}'’]+)/u.exec(s);
    return m ? m[1].toLowerCase() : '';
  };

  // ---------- Fixes ----------
  // Each fixer takes (text, start, end) of a match and returns an edit or null when no safe fix exists.

  const edit = (start, end, text, label) => ({ start, end, text, label });

  function matchCase(src, word) {
    if (src.length > 1 && src === src.toUpperCase() && /\p{L}/u.test(src)) return word.toUpperCase();
    if (/^\p{Lu}/u.test(src)) return word[0].toUpperCase() + word.slice(1);
    return word;
  }

  const swapTo = (word) => (t, s, e) => edit(s, e, matchCase(t.slice(s, e), word), `Change to “${word}”`);

  const swapMap = (map) => (t, s, e) => {
    const w = map[t.slice(s, e).toLowerCase().replace(/[\s’']+/g, (x) => (/\s/.test(x) ? ' ' : "'"))];
    return w ? edit(s, e, matchCase(t.slice(s, e), w), `Change to “${w}”`) : null;
  };

  function atSentenceStart(t, i) {
    let j = i - 1;
    while (j >= 0 && (t[j] === ' ' || t[j] === '\t' || t[j] === ' ')) j--;
    if (j < 0 || t[j] === '\n') return true;
    if (j === i - 1) return false;
    if (/["”’)]/.test(t[j])) j--;
    return j >= 0 && /[.!?]/.test(t[j]);
  }

  // Remove a sentence that the match makes up entirely: "Let that sink in." / "Agree?"
  function dropSentence(t, s, e) {
    if (!atSentenceStart(t, s)) return null;
    const m = /^[.!?…]*["”’)]?/.exec(t.slice(e));
    let end = e + m[0].length;
    const after = t[end];
    const punctuated = m[0].length > 0 || /[.!?:]$/.test(t.slice(s, e));
    if (after !== undefined && after !== '\n' && !(punctuated && /\s/.test(after))) return null;
    let start = s;
    while (start > 0 && (t[start - 1] === ' ' || t[start - 1] === '\t')) start--;
    if (start === 0 || t[start - 1] === '\n') {
      while (end < t.length && (t[end] === ' ' || t[end] === '\t')) end++;
    }
    if (end >= t.length) while (start > 0 && /\s/.test(t[start - 1])) start--;
    return edit(start, end, '', 'Remove');
  }

  // Remove a lead-in at the start of a sentence and capitalize what follows:
  // "Here's the thing: growth wins" -> "Growth wins". `need` says what must follow the phrase
  // for the cut to leave a real sentence: 'punct', 'that-or-punct' or 'none'.
  const dropLead = (need) => (t, s, e) => {
    if (!atSentenceStart(t, s)) return null;
    const m = /^([ \t]+that\b)?[ \t]*([,:;!?—–]|--)?[ \t]*/.exec(t.slice(e));
    const that = !!m[1];
    const punct = !!m[2];
    if (need === 'punct' && !punct) return null;
    if (need === 'that-or-punct' && !that && !punct) return null;
    const end = e + m[0].length;
    const next = t[end];
    if (next === undefined || next === '\n' || /[.!?]/.test(next)) return dropSentence(t, s, e);
    if (/\p{Ll}/u.test(next)) return edit(s, end + 1, next.toUpperCase(), 'Remove');
    return edit(s, end, '', 'Remove');
  };

  // Remove a filler word: "I just think" -> "I think"; "Honestly, it works" -> "It works".
  function dropWord(t, s, e) {
    if (/^[ \t]*,/.test(t.slice(e))) return dropLead('punct')(t, s, e);
    if (atSentenceStart(t, s)) {
      const m = /^[ \t]+(\p{Ll})?/u.exec(t.slice(e));
      if (!m) return null;
      return edit(s, e + m[0].length, m[1] ? m[1].toUpperCase() : '', 'Remove');
    }
    if (t[e] === ' ') return edit(s, e + 1, '', 'Remove');
    if (t[s - 1] === ' ') return edit(s - 1, e, '', 'Remove');
    return null;
  }

  // Remove the match plus the spaces after it (emoji bullets, stray symbols).
  function dropToken(t, s, e) {
    let end = e;
    while (end < t.length && (t[end] === ' ' || t[end] === '\t')) end++;
    return edit(s, end, '', 'Remove');
  }

  // "leverage" is also a noun ("negotiating leverage"), so only swap it when an object follows.
  const USE = { leverage: 'use', leverages: 'uses', leveraged: 'used', leveraging: 'using' };
  function leverageFix(t, s, e) {
    const next = /^\s+([\p{L}']+)/u.exec(t.slice(e));
    const verb = next && /^(?:the|a|an|our|their|your|my|his|her|its|this|that|these|those|it|them|ai|data|existing|every|all|what)$/i.test(next[1]);
    return verb ? swapMap(USE)(t, s, e) : null;
  }

  // "We shipped it — finally." -> "We shipped it, finally."
  function dashFix(t, s, e) {
    let a = s;
    let b = e;
    while (a > 0 && t[a - 1] === ' ') a--;
    while (b < t.length && t[b] === ' ') b++;
    const prev = t[a - 1];
    if (prev === undefined || prev === '\n' || b >= t.length || t[b] === '\n') return null;
    if (/[,.;:!?]/.test(prev)) return edit(a, b, ' ', 'Remove');
    return edit(a, b, ', ', 'Use a comma');
  }

  // ---------- Phrase layer ----------

  const BANNED = [
    ['delv(?:e|es|ed|ing)', 'Say "look at" or "dig into", or just start with the point.',
      swapMap({ delve: 'dig', delves: 'digs', delved: 'dug', delving: 'digging' })],
    ['foster(?:s|ed|ing)?', 'Say "build", "grow" or "encourage".',
      swapMap({ foster: 'build', fosters: 'builds', fostered: 'built', fostering: 'building' })],
    ['leverag(?:e|es|ed|ing)', 'Say "use".', leverageFix],
    ['utili[sz](?:e|es|ed|ing)', 'Say "use".',
      swapMap({ utilize: 'use', utilizes: 'uses', utilized: 'used', utilizing: 'using', utilise: 'use', utilises: 'uses', utilised: 'used', utilising: 'using' })],
    ['utili[sz]ation', 'Say "use".', swapTo('use')],
    ['facilitat(?:e|es|ed|ing)', 'Say "run", "help" or "make easier".'],
    ['empower(?:s|ed|ing|ment)?', 'Say "let" or "help", and name who does what.'],
    ['streamlin(?:e|es|ed|ing)', 'Say what got faster or simpler, and by how much.',
      swapMap({ streamline: 'simplify', streamlines: 'simplifies', streamlined: 'simplified', streamlining: 'simplifying' })],
    ['robust(?:ly|ness)?', 'Name what makes it strong: what it handles or survives.'],
    ['cutting[- ]edge', 'Name the new thing itself.'],
    ['paradigm shifts?', 'Say what changed.'],
    ['game[- ]?chang(?:er|ers|ing)', 'Say what it changes, concretely.'],
    ['this is huge', 'Show why it matters with a fact.', dropSentence],
    ['this changes everything', 'Say what it changes.', dropSentence],
    ['tapestr(?:y|ies)', 'Drop the metaphor and say the thing.'],
    ['(?:in\\s+the\\s+)?realms?(?:\\s+of)?', 'Say "area" or "field", or name it.', swapMap({ 'in the realm of': 'in' })],
    ['beacons?', 'Drop the metaphor.'],
    ['multifaceted', 'Name the parts, or say "complex".', swapTo('complex')],
    ['meticulous(?:ly)?', 'Show the care with a detail.', swapMap({ meticulous: 'careful', meticulously: 'carefully' })],
    ['intricate', 'Say "detailed" or "complex", or show it.', swapTo('complex')],
    ['paramount', 'Say "most important", or show why.'],
    ['transformative', 'Say what changed and how.'],
    // "elevated" is left out: "elevated blood pressure" is normal English.
    ['elevat(?:e|es|ing)', 'Say "improve" or "raise", with specifics.',
      swapMap({ elevate: 'improve', elevates: 'improves', elevating: 'improving' })],
    ['embark(?:s|ed|ing)?(?:\\s+(?:up)?on)?', 'Say "start".',
      swapMap({ 'embark on': 'start', 'embarks on': 'starts', 'embarked on': 'started', 'embarking on': 'starting',
        'embark upon': 'start', 'embarks upon': 'starts', 'embarked upon': 'started', 'embarking upon': 'starting' })],
    ['supercharg(?:e|es|ed|ing)', 'Say what got faster, and by how much.'],
    ['harness(?:es|ed|ing)?(?=\\s+the\\s+(?:power|potential))', 'Say "use".',
      swapMap({ harness: 'use', harnesses: 'uses', harnessed: 'used', harnessing: 'using' })],
    ['ever[- ](?:evolving|changing)', 'Cut it.', dropWord],
    // Words that became far more common once people started pasting chatbot output.
    ['seamless(?:ly)?', 'Say what actually got easier.'],
    ['synerg(?:y|ies|istic)', 'Say what the two things do together.'],
    ['holistic(?:ally)?', 'Say what it covers.'],
    ['(?:a\\s+)?(?:myriad|plethora)(?:\\s+of)?', 'Say "many", or give the number.', swapTo('many')],
    ['bustling', 'Drop it, or describe the actual scene.'],
    ['unlock(?:s|ed|ing)?\\s+(?:the\\s+|your\\s+|its\\s+|their\\s+|our\\s+)?(?:full\\s+|true\\s+)?potential', 'Say what becomes possible.'],
    ['navigat(?:e|es|ed|ing)\\s+the\\s+(?:complexities|challenges|intricacies)', 'Name the specific problem.'],
    ['groundbreaking', 'Say what is actually new.'],
    ['revolutioni[sz](?:e|es|ed|ing)', 'Say what changed.'],
    ['unparalleled|unwavering', 'Show it with a fact.'],
    ['resonat(?:e|es|ed|ing)\\s+with', 'Say how people actually reacted.'],
    ['showcas(?:e|es|ed|ing)', 'Say "show", or show it.'],
  ].map(([src, fix, fixer]) => ({ re: new RegExp('\\b(?:' + src + ')\\b', 'gi'), fix, fixer }));

  // A rule has: id, label, severity ('slop' | 'hint'), fix (advice), and either `patterns`
  // (regexes, or { re, edit, fix }) or `find(text)` returning spans. A regex may use a named
  // group `x` to narrow the highlighted span. `option` gates a rule behind a detect() option.
  const RULES = [
    {
      id: 'banned-word',
      label: 'AI vocabulary',
      severity: 'slop',
      find(text) {
        const out = [];
        for (const { re, fix, fixer } of BANNED) {
          re.lastIndex = 0;
          let m;
          while ((m = re.exec(text))) {
            const s = m.index;
            const e = s + m[0].length;
            out.push({ start: s, end: e, fix, edit: fixer ? fixer(text, s, e) : null });
          }
        }
        return out;
      },
    },
    {
      id: 'chatbot-residue',
      label: 'Chatbot leftovers',
      severity: 'slop',
      fix: 'This is chatbot phrasing. Cut it.',
      patterns: [
        { re: new RegExp(START + '(?<x>(?:Certainly|Great question|What a great question)[!.])', 'gdi'), edit: dropSentence },
        {
          re: phraseRe(['i hope this email finds you well', 'i hope this message finds you well', 'i hope this note finds you well',
            'i hope this helps', "i'd be happy to help", 'i would be happy to help']),
          edit: dropSentence,
        },
        { re: /\b(?:feel free to|don['’]t hesitate to)\s+(?:reach out|contact|ask|let (?:me|us) know)[^.!?\n]*/gi, edit: dropSentence },
        { re: /\blet (?:me|us) know if you have any (?:other |further |more |additional )?questions[^.!?\n]*/gi, edit: dropSentence },
        {
          re: /\bhere(?:['’]s| is) (?:a|the|your) (?:revised|rewritten|polished|improved|refined|updated|more concise|shorter|cleaner) (?:version|draft)[^.!?\n:]*[:.]?/gi,
          edit: dropSentence,
        },
        { re: /\bas an ai(?: language model)?\b/gi, fix: 'Pasted straight from a chatbot.' },
        {
          re: /\[(?:your|recipient|company|client|insert|first name|last name|name|date|product)\b[^\]\n]{0,30}\](?!\()/gi,
          fix: 'Unfilled template placeholder.',
        },
      ],
    },
    {
      id: 'binary-contrast',
      label: 'Binary contrast',
      severity: 'slop',
      fix: 'Drop the "not X" half and state Y directly.',
      patterns: [
        // "It's not X. It's Y."  /  "This isn't about X, it's about Y."
        new RegExp(
          '\\b(?:it|this|that)(?:' + AP + 's|\\s+is|\\s+was)\\s+not\\s+(?:just\\s+|only\\s+|about\\s+)?[^.!?\\n]{1,80}?[.;,:—–]\\s*(?:it|this|that)(?:' + AP + 's|\\s+is|\\s+was)\\b',
          'gi'
        ),
        new RegExp(
          '\\b(?:isn' + AP + 't|is\\s+not|wasn' + AP + 't|was\\s+not|aren' + AP + 't|are\\s+not)\\s+(?:just\\s+|only\\s+|about\\s+)?[^.!?\\n]{1,60}?[.;,:—–]\\s*(?:it|this|that|they)(?:' + AP + 's|' + AP + 're|\\s+is|\\s+are)\\b',
          'gi'
        ),
        /\bnot\s+(?:just|only|merely)\s+[^.!?\n]{1,60}?,?\s+but\b/gi,
        // "AI stops being a feature and becomes the product."
        /\bstops?\s+being\s+[^.!?\n]{1,40}?\s+and\s+(?:starts?\s+being|becomes?)\b/gi,
      ],
    },
    {
      id: 'contrast-tail',
      label: 'Contrast tails',
      severity: 'slop',
      fix: 'Say what it is; drop the ", not X" tacked onto the end.',
      find: findContrastTails,
    },
    {
      id: 'throat-clearing',
      label: 'Throat-clearing opener',
      severity: 'slop',
      fix: 'Cut it and state the point.',
      patterns: [
        {
          re: phraseRe(["here's the thing", "here's what i mean", "here's the deal", 'let me be clear', "i'll be honest",
            "let's be honest", "let's be real", 'hot take']),
          edit: dropLead('punct'),
        },
        { re: phraseRe(['the uncomfortable truth is', 'the hard truth is', 'the harsh truth is']), edit: dropLead('none') },
        {
          re: new RegExp('\\b(?:(?:i' + AP + 'm|i\\s+am|we' + AP + 're|we\\s+are)\\s+)?(?:so\\s+|very\\s+|incredibly\\s+|beyond\\s+)?(?:thrilled|excited|delighted|proud|honou?red)\\s+to\\s+(?:announce|share)\\b', 'gi'),
          edit: dropLead('that-or-punct'),
        },
        new RegExp('\\b(?:i' + AP + 'm\\s+)?humbled(?:\\s+and\\s+honou?red)?\\b', 'gi'),
        // "Here's what I learned:" / "Here are 3 things..." announcing a list instead of starting it.
        new RegExp(START + '(?<x>Here(?:' + AP + 's|\\s+is|\\s+are)\\s+(?:what|why|how|\\d+|(?:a\\s+)?few|some|my|our|the\\s+(?:kicker|thing|deal|truth|catch|twist|problem|reality|breakdown|playbook|framework|secret|lessons?|takeaways?|result|math|plan|part|good\\s+news|bad\\s+news))\\b[^.!?\\n:]{0,60}?(?::|\\.{3}|…|\\s*👇))', 'gdi'),
      ],
    },
    {
      id: 'faux-insight',
      label: 'Faux-insight setup',
      severity: 'slop',
      fix: 'Cut the setup and let the claim stand on its own.',
      patterns: [
        /\b(?:most people|nobody|no one|everyone|few people|what nobody|what no one)\s+(?:skips?|gets?\s+wrong|miss(?:es)?|tells?\s+you|talks?\s+about|is\s+talking\s+about|realizes?|understands?)\b/gi,
        phraseRe(["what they don't tell you", "what they won't tell you", 'the secret nobody', 'the part everyone misses']),
      ],
    },
    {
      id: 'colon-reveal',
      label: 'Colon reveal',
      severity: 'slop',
      fix: 'Rewrite as a plain sentence. Save colons for lists and labels.',
      patterns: [
        new RegExp(START + '(?<x>(?:(?:And|But)\\s+)?(?:The|My|Our|Your|Their|His|Her|This|One|Its)\\s[^.:!?\\n]{2,48}:)[ \\t]+(?=[a-z])', 'gd'),
      ],
    },
    {
      id: 'question-reveal',
      label: 'Self-answered question',
      severity: 'slop',
      fix: 'Drop the question and make the point.',
      patterns: [
        new RegExp(START + '(?<x>(?:(?:And|But)\\s+)?The(?:\\s+[a-z]+){1,3}\\?)[ \\t]+(?=[A-Z0-9])', 'gd'),
        /\b(?<x>Why\?)\s+Because\b/gd,
      ],
    },
    {
      id: 'superficial-analysis',
      label: 'Superficial analysis',
      severity: 'slop',
      fix: 'Replace the -ing clause with the concrete consequence.',
      patterns: [
        /,\s+(?<x>(?:highlighting|underscoring|reflecting|showcasing|emphasi[sz]ing|demonstrating|signal(?:l)?ing|illustrating|cementing|solidifying|reinforcing))\b/gid,
      ],
    },
    {
      id: 'puffery',
      label: 'Importance puffery',
      severity: 'slop',
      fix: 'State the fact and let the reader judge whether it matters.',
      patterns: [
        /\b(?:stands?\s+as\s+a\s+testament|a\s+testament\s+to|marks?\s+a\s+(?:pivotal|significant|major|key|defining)\s+(?:moment|milestone|shift)|pivotal\s+moment|plays?\s+an?\s+(?:vital|crucial|key|pivotal|critical|significant|instrumental)\s+role|solidif(?:y|ies|ied)\s+(?:its|their|our|his|her)\s+(?:position|place|status)|underscores?\s+(?:the\s+|its\s+)?(?:importance|significance)|can(?:not|'t|’t)\s+be\s+overstated|a\s+significant\s+milestone)\b/gi,
      ],
    },
    {
      id: 'metadiscourse',
      label: 'Telling the reader what to think',
      severity: 'slop',
      fix: 'Delete the aside. If the point is clear, it needs no signpost.',
      patterns: [
        {
          re: phraseRe(["it's worth noting", 'it is worth noting', "it's worth mentioning", "it's worth pointing out",
            "it's important to note", 'it is important to note']),
          edit: dropLead('none'),
        },
        { re: phraseRe(['needless to say', 'make no mistake', 'in other words', 'as you can see']), edit: dropLead('punct') },
        { re: phraseRe(['let that sink in', 'read that again', 'this is important']), edit: dropSentence },
        phraseRe(['that last part matters', 'matters more than it sounds', 'the key point is', 'the key takeaway',
          'the key insight', 'this distinction matters', 'matters more than ever']),
      ],
    },
    {
      id: 'empty-phrase',
      label: 'Empty phrase',
      severity: 'slop',
      fix: 'Cut it. It delays the point.',
      patterns: [
        {
          re: phraseRe(['at the end of the day', "in today's fast-paced world", "in today's digital age", "in today's world",
            'going forward', 'in this article', 'in this post', 'at its core']),
          edit: dropLead('punct'),
        },
        { re: phraseRe(['the reality is', 'the truth is']), edit: dropLead('none') },
        { re: phraseRe(["let's dive in", "let's dive deep", 'without further ado']), edit: dropSentence },
        phraseRe(['in the age of', 'in the world of', "let's dive into", 'in a world where', 'in an era of', 'in an era where',
          'now more than ever', 'more important than ever', "it's no secret that"]),
      ],
    },
    {
      id: 'weasel',
      label: 'Weasel attribution',
      severity: 'slop',
      fix: 'Name the source, or cut the claim.',
      patterns: [
        phraseRe(['experts agree', 'experts say', 'experts believe', 'industry reports suggest', 'reports suggest',
          'studies show', 'studies suggest', 'research shows', 'research suggests', 'many argue', 'some argue',
          'many believe', 'it is widely believed', 'widely regarded as', 'widely considered']),
      ],
    },
    {
      id: 'fake-verb',
      label: 'Fake-strong verb',
      severity: 'slop',
      fix: 'Use "is", or say what it actually does.',
      patterns: [
        {
          re: /\b(?:serves?|served|serving|stands?|stood|functions?|functioned)\s+as\s+(?:a|an|the)\b/gi,
          edit(t, s, e) {
            const m = /^(serves|stands|functions)\s+as\s+/i.exec(t.slice(s, e));
            return m ? edit(s, s + m[0].length, matchCase(m[1], 'is') + ' ', 'Change to “is”') : null;
          },
        },
      ],
    },
    {
      id: 'negative-listing',
      label: 'Negative listing',
      severity: 'slop',
      fix: 'Skip the "Not X. Not Y." and just say what it is.',
      patterns: [
        new RegExp(START + '(?<x>Not\\s[^.!?\\n]{1,50}[.!]\\s+Not\\s[^.!?\\n]{1,50}[.!])', 'gd'),
        new RegExp(START + '(?<x>No\\s[^.!?\\n]{1,40}[.!]\\s+No\\s[^.!?\\n]{1,40}[.!])', 'gd'),
        // "Less speculation. More infrastructure."
        new RegExp(START + '(?<x>(?:Less|Fewer)\\s[^.!?\\n]{1,40}[.!]\\s+More\\s[^.!?\\n]{1,40}[.!]|More\\s[^.!?\\n]{1,40}[.!]\\s+(?:Less|Fewer)\\s[^.!?\\n]{1,40}[.!])', 'gd'),
      ],
    },
    {
      id: 'dramatic-fragment',
      label: 'Dramatic fragments',
      severity: 'slop',
      fix: 'Use complete sentences.',
      patterns: [
        {
          re: phraseRe(["that's it. that's the whole thing", "that's it. that's all", "that's the whole thing", "that's the whole game"]),
          edit: dropSentence,
        },
        new RegExp(START + '(?<x>And\\s[^.!?\\n]{1,30}\\.\\s+And\\s[^.!?\\n]{1,30}\\.)', 'gd'),
      ],
      find: findStackedFragments,
    },
    {
      id: 'rhetorical-setup',
      label: 'Rhetorical setup',
      severity: 'slop',
      fix: 'Drop the setup and make the point.',
      patterns: [
        { re: phraseRe(['plot twist', 'spoiler alert', 'guess what', "here's the kicker", "but here's the twist"]), edit: dropLead('punct') },
        { re: phraseRe(['think about it', 'sound familiar?']), edit: dropSentence },
        phraseRe(['what if i told you', "let's break it down", "let's break this down", "let's unpack"]),
        // "Bottom line: ..." / "Key takeaway: ..."
        new RegExp(START + '(?<x>(?:The\\s+)?(?:Bottom line|Key takeaways?|Takeaways?|Pro tip|Real talk|Short version|Big picture|Why (?:it|this) matters|Upshot|Kicker|My take|Final thoughts?)\\s*[:—–])', 'gdi'),
      ],
    },
    {
      id: 'kicker',
      label: 'Fake-profound kicker',
      severity: 'slop',
      fix: 'Delete it and end on your clearest concrete sentence.',
      patterns: [
        {
          re: phraseRe(['and that makes all the difference', "and that's the whole point", 'the rest is history',
            "and that's everything", "that's the real lesson", 'full stop']),
          edit: dropSentence,
        },
      ],
    },
    {
      id: 'recap',
      label: 'Summary-recap ending',
      severity: 'slop',
      fix: 'The reader was just there. End on the last concrete point.',
      patterns: [
        {
          re: new RegExp(START + '(?<x>In\\s+conclusion|In\\s+summary|To\\s+sum\\s+up|To\\s+summari[sz]e|Ultimately|All\\s+in\\s+all)(?=,)', 'gd'),
          edit: dropLead('punct'),
        },
      ],
    },
    {
      id: 'em-dash',
      label: 'Em dash',
      severity: 'slop',
      find(text) {
        const hits = [];
        const re = /—|(?<=\S) -- (?=\S)|(?<=\S) – (?=\S)/g;
        let m;
        while ((m = re.exec(text))) hits.push({ start: m.index, end: m.index + m[0].length });
        const words = countWords(text);
        let fix = null;
        if (words <= 120 && hits.length) fix = 'Short copy: use a comma, period or parentheses instead.';
        else if (hits.length > 2) fix = `${hits.length} em dashes. Keep 1 or 2 at most.`;
        return fix ? hits.map((h) => ({ ...h, fix, edit: dashFix(text, h.start, h.end) })) : [];
      },
    },
    {
      id: 'emoji-bullets',
      label: 'Emoji bullets',
      severity: 'slop',
      find(text) {
        const hits = [];
        const re = /^[ \t]*(?<x>(?:\p{Extended_Pictographic}|[0-9#*]\uFE0F?\u20E3)\uFE0F?)/gmud;
        let m;
        while ((m = re.exec(text))) hits.push({ start: m.indices.groups.x[0], end: m.indices.groups.x[1] });
        if (hits.length < 2) return [];
        return hits.map((h) => ({ ...h, fix: 'Let the content carry the structure, not emoji.', edit: dropToken(text, h.start, h.end) }));
      },
    },
    {
      id: 'arrow-list',
      label: 'Arrow bullets',
      severity: 'slop',
      fix: 'Write the point as a sentence instead of "X → Y".',
      find(text) {
        const hits = runRegex(/→|⟶|➝|➜|➡️?|⇒|↳|(?<=\s)(?:->|=>)(?=\s)/gu, text);
        const lines = new Set(hits.map((h) => text.lastIndexOf('\n', h.start)));
        return lines.size >= 2 ? hits : [];
      },
    },
    {
      id: 'fancy-text',
      label: 'Fancy Unicode text',
      severity: 'slop',
      fix: 'Use plain text. Screen readers and search skip these lookalike letters.',
      find(text) {
        // 𝐁𝐨𝐥𝐝 and 𝘪𝘵𝘢𝘭𝘪𝘤 letters from the Mathematical Alphanumeric block, made by post-formatting tools.
        return runRegex(/[\u{1D400}-\u{1D7FF}](?:[\u{1D400}-\u{1D7FF}\s'’&+:,.()-]*[\u{1D400}-\u{1D7FF}])?/gu, text)
          .filter((h) => [...text.slice(h.start, h.end)].filter((c) => c.codePointAt(0) >= 0x1d400).length >= 3);
      },
    },
    {
      id: 'label-lines',
      label: 'Label-colon lines',
      severity: 'slop',
      fix: 'Several "Label: explanation" lines in a row read like a pasted chatbot answer. Write it as prose.',
      find: findLabelLines,
    },
    {
      id: 'engagement-bait',
      label: 'Engagement bait',
      severity: 'slop',
      fix: 'Cut it. A good post gets replies without asking.',
      patterns: [
        {
          re: new RegExp(START + '(?<x>Agree\\?|Thoughts\\?|Repost if[^.!?\\n]*|Comment below[^.!?\\n]*|Drop (?:a|your)\\s[^.!?\\n]*(?:below|comments?)[^.!?\\n]*|Follow (?:me )?for more[^.!?\\n]*|What would you add[^.!?\\n]*\\?|What' + AP + 's your take\\?|Save this (?:for|post)[^.!?\\n]*|Curious (?:to hear|what you think)[^.!?\\n]*)', 'gd'),
          edit: dropSentence,
        },
        { re: /♻️?/gu, edit: dropToken },
      ],
    },
    {
      id: 'markdown-leak',
      label: 'Pasted formatting',
      severity: 'slop',
      option: 'markdown',
      fix: 'This site shows the symbols literally. Remove them.',
      patterns: [
        { re: /\*\*(?=\S)([^*\n]{1,80}?)(?<=\S)\*\*/g, edit: (t, s, e) => edit(s, e, t.slice(s + 2, e - 2), 'Remove the asterisks') },
        { re: /^[ \t]*#{1,6}[ \t]+/gm, edit: (t, s, e) => edit(s, e, '', 'Remove the # marks') },
      ],
    },

    // ---------- Style layer: signals that only show up across sentences ----------
    {
      id: 'transition-pile',
      label: 'Essay transitions',
      severity: 'slop',
      fix: 'Several formal transitions in one piece reads as generated. Most can go.',
      find(text) {
        const re = new RegExp(START + '(?<x>Moreover|Furthermore|Additionally|In addition|Consequently|Notably|Importantly|Crucially|Interestingly|Hence|Thus|Therefore)(?=,)', 'gd');
        const spans = runRegex(re, text);
        if (spans.length < 2) return [];
        return spans.map((s) => ({ ...s, edit: dropLead('punct')(text, s.start, s.end) }));
      },
    },
    {
      id: 'rule-of-three',
      label: 'Rule of three',
      severity: 'slop',
      fix: 'Three-item lists everywhere read as generated. Keep the items that matter.',
      find(text) {
        // The lookbehind anchors matches at word starts; without it a long word is quadratic.
        const spans = runRegex(/(?<![\p{L}\p{N}'’-])[\p{L}\p{N}'’-]+,\s(?:[\p{L}\p{N}'’-]+\s){0,2}?[\p{L}\p{N}'’-]+,?\s(?:and|or)\s[\p{L}\p{N}'’-]+/gu, text);
        // Lists of names ("Omsk, Perm and Kazan") are normal; the tell is abstract triples ("speed, clarity, and trust").
        const abstract = spans.filter((sp) => !text.slice(sp.start, sp.end).split(/,\s|,?\s(?:and|or)\s/).every((w) => /^\p{Lu}/u.test(w)));
        const words = countWords(text);
        return abstract.length >= 3 && words / abstract.length <= 60 ? abstract : [];
      },
    },
    {
      id: 'repetitive-openers',
      label: 'Repetitive openers',
      severity: 'slop',
      fix: 'Short sentences in a row that start or end the same way. Vary them, or merge them.',
      find(text) {
        const out = [];
        const sents = sentences(text);
        let run = [];
        const flush = () => {
          if (run.length >= 3) out.push({ start: run[0].start, end: run[run.length - 1].end });
          run = [];
        };
        for (const s of sents) {
          const w = firstWord(s.text);
          if (!w || s.words > 8) {
            flush();
            continue;
          }
          if (run.length && firstWord(run[0].text) !== w) flush();
          run.push(s);
        }
        flush();
        // Echo pairs: "Taste still matters. Conviction still matters."
        for (let i = 1; i < sents.length; i++) {
          const a = sents[i - 1];
          const b = sents[i];
          // Short declaratives with different openers and no dialogue: fiction repeats lines all the time.
          if (a.words > 6 || b.words > 6 || a.words < 2 || b.words < 2 || !/\.$/.test(a.text) || !/\.$/.test(b.text)) continue;
          if (firstWord(a.text) === firstWord(b.text) || /["“”*]/.test(a.text + b.text)) continue;
          const tail = (s) => (s.text.toLowerCase().match(/[\p{L}\p{N}'’]+/gu) || []).slice(-2).join(' ');
          if (tail(a) === tail(b) && a.text.toLowerCase() !== b.text.toLowerCase()) out.push({ start: a.start, end: b.end });
        }
        return out;
      },
    },

    // Hints (off by default): wordy, but people use them as often as models do.
    {
      id: 'wordy-phrase',
      label: 'Wordy phrase',
      severity: 'hint',
      fix: 'Say it in fewer words.',
      patterns: [
        { re: phraseRe(['in order to']), edit: swapTo('to'), fix: '"In order to" is just "to".' },
        { re: phraseRe(['with regard to', 'with regards to']), edit: swapTo('about'), fix: 'Say "about".' },
        phraseRe(['when it comes to', 'in terms of']),
      ],
    },
    {
      id: 'hedge-stack',
      label: 'Stacked hedge',
      severity: 'hint',
      fix: 'One hedge is enough.',
      patterns: [
        {
          re: /\b(may|might|could|can)\s+(?:potentially|possibly|perhaps|conceivably)\b/gi,
          edit: (t, s, e) => {
            const w = /^\w+/.exec(t.slice(s, e))[0];
            return edit(s, e, w, `Change to “${w}”`);
          },
        },
      ],
    },
    {
      id: 'empty-adverb',
      label: 'Often-empty adverb',
      severity: 'hint',
      fix: 'Cut it unless it carries real emphasis or your natural rhythm.',
      patterns: [
        { re: /\b(?:just|literally|honestly|simply|actually|truly|fundamentally|importantly|crucially|inherently|inevitably)\b/gi, edit: dropWord },
      ],
    },
  ];

  // Why each pattern reads as generated, for someone reading the text (the rules' `fix` is advice
  // for the writer).
  const WHY = {
    'banned-word': 'A word chatbots use far more often than people do.',
    'chatbot-residue': 'Leftover phrasing from a chatbot conversation.',
    'binary-contrast': "Knocks down a claim nobody made, to sound insightful. A signature chatbot move.",
    'contrast-tail': 'Ends clause after clause with ", not X", a contrast nobody asked for.',
    'throat-clearing': 'Announces a point instead of making it.',
    'faux-insight': 'Dresses up an ordinary point as secret knowledge.',
    'colon-reveal': 'Fake suspense: a label, a colon, then the punchline.',
    'question-reveal': 'Asks a question just to answer it for drama.',
    'superficial-analysis': 'A trailing -ing clause that sounds like analysis but adds none.',
    puffery: 'Inflates importance instead of stating a fact.',
    metadiscourse: 'Tells you how to read the text instead of saying something.',
    'empty-phrase': 'A stock phrase that fills space.',
    weasel: 'Claims authority without naming a source.',
    'fake-verb': '"Serves as" or "stands as" where a person would write "is".',
    'negative-listing': '"Not X. Not Y. Z." A dramatic formula.',
    'dramatic-fragment': 'Short punchy fragments stacked for effect.',
    'rhetorical-setup': 'A setup line that builds fake suspense.',
    kicker: 'A fake-profound closing line.',
    recap: 'Restates what you just read.',
    'em-dash': 'Em dashes all over a short post are a common chatbot tell.',
    'emoji-bullets': 'Emoji used as bullet points, typical of templated posts.',
    'arrow-list': '"X → Y" lines instead of sentences, a templated-post habit.',
    'fancy-text': 'Bold or italic lookalike letters from a post-formatting tool.',
    'label-lines': 'A stack of "Label: explanation" lines, the shape of a pasted chatbot answer.',
    'engagement-bait': 'Fishing for comments and reposts.',
    'markdown-leak': 'Chatbot formatting (** or #) pasted somewhere it does not render.',
    'transition-pile': 'Stacked essay transitions like "Moreover" and "Furthermore".',
    'rule-of-three': 'Lists of three, over and over.',
    'repetitive-openers': 'Short sentences in a row that start or end the same way.',
    'wordy-phrase': 'Wordy, though people write this too.',
    'hedge-stack': 'Two hedges where one would do.',
    'empty-adverb': 'A filler adverb, though people use these too.',
  };

  // Three or more very short sentences in a row: "Fast. Simple. Done."
  function findStackedFragments(text) {
    const out = [];
    let run = [];
    const flush = () => {
      if (run.length >= 3) out.push({ start: run[0].start, end: run[run.length - 1].end, fix: 'Stacked punchy fragments. Combine them into a real sentence.' });
      run = [];
    };
    for (const s of sentences(text)) {
      // Citations and references ("Frost, Robert." "Books.Google.com." "Since 2010.") are short too;
      // slop fragments ("Fast. Simple. Done.") have no digits, commas, quotes or dotted names.
      const plain = !/[\d,"\u201c\u201d]|\p{L}\.\p{L}/u.test(s.text);
      if (s.terminal && s.words >= 1 && s.words <= 3 && plain) run.push(s);
      else flush();
    }
    flush();
    return out;
  }

  // ", not X" at the end of a clause: "architects, not lecturers." One is normal English; the tell
  // is the habit, so it takes two. Also "not X, just Y".
  const NOT_TAIL = /(?:,["”’)]?|\s[—–]|\s-)\s*not\s+(?!(?:sure|bad|yet|really|anymore|even|much|now|always|that|so|too|all|everyone|necessarily|exactly|quite|very|to|least|unlike|counting|including|bothering)\b)(?:just\s+|only\s+|merely\s+|simply\s+)?[\p{L}\p{N}][^,.;:!?\n—–]{0,40}?(?=\s*(?:[.!?;]|\n|$))/gu;
  const NOT_JUST = /(?<![\p{L}'’])not\s+[\p{L}'’ -]{1,30},\s+just\s+\p{L}+/giu;
  function findContrastTails(text) {
    const hits = [...runRegex(NOT_TAIL, text), ...runRegex(NOT_JUST, text)];
    return hits.length >= 2 ? hits : [];
  }

  // "Label: explanation" lines, three or more. Form fields ("Date: Monday at 3pm") don't count.
  const FORM_LABEL = /^(?:date|time|when|where|location|venue|address|phone|tel|e-?mail|subject|from|to|cc|bcc|re|price|cost|name|title|notes?|ps|p\.s|edit|update|source|sources|links?|website|agenda|attendees|q|a|question|answer|tl;?dr|eta|status|step\s*\d+)$/i;
  function findLabelLines(text) {
    const out = [];
    const re = /^[ \t]*(?:[-•*·▪►→]\s*|\d+[.)]\s+|\p{Extended_Pictographic}\uFE0F?\s*)?(?<x>[\p{Lu}\p{N}][^:\n]{1,40}?):[ \t]+(?<rest>[^\n]+)$/gmud;
    let m;
    while ((m = re.exec(text))) {
      const label = m.groups.x.trim();
      const words = countWords(label);
      if (words < 1 || words > 6 || !/\p{L}$/u.test(label) || FORM_LABEL.test(label) || /https?$|[*"“”]/i.test(label)) continue;
      // Names ("Andreas Suter:", "JOHN:") are speakers in a transcript, not labels.
      if (words > 1 && !/(?:^|\s)\p{Ll}/u.test(label)) continue;
      if (label === label.toUpperCase()) continue;
      if (countWords(m.groups.rest) < 4 || !/\p{Ll}/u.test(m.groups.rest)) continue;
      out.push({ start: m.indices.groups.x[0], end: m.indices.groups.x[1] + 1, label: label.toLowerCase() });
    }
    // A transcript repeats its speakers; a pasted list of labels doesn't.
    if (out.length < 3 || new Set(out.map((o) => o.label)).size < out.length) return [];
    return out.map(({ start, end }) => ({ start, end }));
  }

  function runRegex(re, text) {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (m.indices && m.indices.groups && m.indices.groups.x) {
        out.push({ start: m.indices.groups.x[0], end: m.indices.groups.x[1] });
      } else {
        out.push({ start: m.index, end: m.index + m[0].length });
      }
    }
    return out;
  }

  /**
   * detect(text, { hints, disabled, markdown }) -> findings sorted by position:
   * { rule, label, severity, start, end, text, fix, edit }
   * edit is { start, end, text, label, from } or null. `from` is the original text it replaces,
   * so callers can check the text hasn't changed before applying it.
   */
  function detect(text, opts) {
    const o = opts || {};
    const disabled = new Set(o.disabled || []);
    const findings = [];
    const seen = new Set();
    for (const rule of RULES) {
      if (rule.severity === 'hint' && !o.hints) continue;
      if (rule.option && !o[rule.option]) continue;
      if (disabled.has(rule.id)) continue;
      const spans = [];
      for (const p of rule.patterns || []) {
        const re = p instanceof RegExp ? p : p.re;
        for (const s of runRegex(re, text)) {
          const fixer = p.edit || null;
          spans.push({ ...s, fix: p.fix, edit: fixer ? fixer(text, s.start, s.end) : null });
        }
      }
      if (rule.find) spans.push(...rule.find(text));
      for (const s of spans) {
        const key = s.start + ':' + s.end;
        if (seen.has(key)) continue; // the first (more specific) rule wins an identical span
        seen.add(key);
        const e = s.edit || null;
        findings.push({
          rule: rule.id,
          label: rule.label,
          severity: rule.severity,
          start: s.start,
          end: s.end,
          text: text.slice(s.start, s.end),
          fix: s.fix || rule.fix,
          why: WHY[rule.id] || '',
          edit: e ? { ...e, from: text.slice(e.start, e.end) } : null,
        });
      }
    }
    findings.sort((a, b) => a.start - b.start || b.end - a.end);
    return findings;
  }

  // Slop meter for a piece of text: how many slop patterns it has, scaled down for long texts so a
  // long article isn't "pure slop" just for being long. Levels were set from the RAID benchmark,
  // where 3+ patterns showed up in 22% of AI-written news and none of the human-written news.
  const LEVELS = ['No slop', 'A little slop', 'Some slop', 'Heavy slop', 'Pure slop'];
  // Writing habits count once however often they repeat; phrases count once per distinct phrase,
  // so "leverage" four times or a page full of three-item lists can't max out the meter alone.
  const HABITS = new Set(['rule-of-three', 'em-dash', 'emoji-bullets', 'transition-pile', 'repetitive-openers', 'dramatic-fragment',
    'contrast-tail', 'arrow-list', 'fancy-text', 'label-lines']);
  // With the style model loaded (style.js + model.js), the level comes from the model, which weighs
  // word choice, rhythm and these same rule hits; its thresholds were set on held-out human writing
  // (see scripts/model/). Without it, or for very short texts, the level is the signal count.
  // With Deep check on, `neural` is the neural detector's logit for the text: the level then comes
  // from a blend of both models, calibrated the same way (neural/config.js).
  function score(findings, text, neural) {
    const signals = new Set();
    for (const f of findings) {
      if (f.severity !== 'slop') continue;
      signals.add(HABITS.has(f.rule) ? f.rule : `${f.rule}|${f.text.toLowerCase().replace(/\s+/g, ' ')}`);
    }
    const count = signals.size;
    const words = countWords(text);
    const scaled = words > 600 ? (count * 600) / words : count;
    let level = scaled >= 5 ? 4 : scaled >= 3 ? 3 : scaled >= 2 ? 2 : scaled >= 1 ? 1 : 0;
    const S = root.SlopgaugeStyle;
    const style = S && root.SlopgaugeModel ? S.assess(text, findings) : null;
    const toLevel = (x, t) => (x >= t[3] ? 4 : x >= t[2] ? 3 : x >= t[1] ? 2 : x >= t[0] ? 1 : 0);
    if (style) level = toLevel(style.logit, root.SlopgaugeModel.levels);
    const B = root.SlopgaugeNeuralConfig && root.SlopgaugeNeuralConfig.blend;
    let deep = null;
    if (style && B && typeof neural === 'number' && isFinite(neural)) {
      const z = (B.neural * (neural - B.neuralMean)) / B.neuralStd + (B.style * (style.logit - B.styleMean)) / B.styleStd;
      level = toLevel(z, B.levels);
      deep = { p: 1 / (1 + Math.exp(-neural)), z };
    }
    return { count, words, level, label: LEVELS[level], style, deep };
  }

  // Apply the non-overlapping edits from `findings` to `text` (back to front, so offsets stay valid).
  function applyEdits(text, findings) {
    const edits = findings.map((f) => f.edit).filter(Boolean).sort((a, b) => b.start - a.start || b.end - a.end);
    let out = text;
    let limit = Infinity;
    for (const e of edits) {
      if (e.end > limit) continue;
      out = out.slice(0, e.start) + e.text + out.slice(e.end);
      limit = e.start;
    }
    return out;
  }

  // Apply every available fix, re-detecting between passes since one fix can unlock another.
  function fixAll(text, opts) {
    for (let i = 0; i < 6; i++) {
      const next = applyEdits(text, detect(text, opts));
      if (next === text) break;
      text = next;
    }
    return text;
  }

  const api = { detect, score, LEVELS, applyEdits, fixAll, sentences, RULES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Slopgauge = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
