const mayurDecoder = require('./mayur_decoder');
const rassDecoder = require('./rass_decoder');
const smartiDecoder = require('./smarti_decoder');
const raxDecoder = require('./rax_decoder');
const securicoDecoder = require('./securico_decoder');

module.exports = {
  mayur: mayurDecoder,
  rass: rassDecoder,
  smarti: smartiDecoder,
  rax: raxDecoder,
  securico: securicoDecoder
};
