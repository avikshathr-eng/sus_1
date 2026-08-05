// Canonical Red Flag / Relax / result-text colors. Kept in sync BY HAND with
// the --flag / --relax / --vote-result-text / --brand-period custom
// properties in styles.css — this codebase has no CSS-in-JS or build-time
// variable injection, so there's no single mechanism that could enforce
// that automatically. Update both places together.
//
// Used directly (as literal hex, not CSS var references) anywhere a color
// gets interpolated by framer-motion's useTransform — its color mixer needs
// a concrete parseable value, not a var() string. Plain style/prop
// assignments elsewhere can use the CSS vars instead.
export const VOTE_COLORS = {
  redFlag: '#D3453B',
  relax: '#449F66',
  resultText: '#FFF8F0',
}
