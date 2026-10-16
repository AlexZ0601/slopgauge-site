// Slopgauge Pro: the seller's public details on Polar (polar.sh), the merchant of record that takes
// payments and issues license keys. Nothing here is secret: buyers see all of it. While a field is
// empty, the button that needs it falls back to email, so the site works before Polar is set up.
window.SlopgaugeProConfig = {
  organizationId: '', // Polar → Settings → Organization ID (a UUID)
  checkout: {
    teacherYearly: '', // Polar checkout link: Slopgauge Pro, $39 a year
    teacherMonthly: '', // Polar checkout link: Slopgauge Pro, $4.99 a month
    school: '', // Polar checkout link: School license, $299 a year
    support: '', // Polar checkout link: Support Slopgauge, pay what you want
  },
  portal: '', // Polar customer portal link, where buyers manage or cancel
};
