// jscs:disable requireCamelCaseOrUpperCaseIdentifiers
const _ = require('lodash');

const $LowercaseFilter = {name: 'lowercase'};
const $StandardTokenizer = {name: 'standard'};
const $KeywordTokenizer = {name: 'keyword'};
const $WhitespaceTokenizer = {name: 'whitespace'};

const $PhoneticEdgeGramFilter = {
    name: 'phonetic_edgeGram_filter',
    value: {
        type: 'edgeNGram',
        min_gram: 1,
        max_gram: 20,
        token_chars: [
            'letter',
            'digit',
            'punctuation',
            'symbol'
        ]
    }
};

const $EdgeGramFilter = {
    name: 'edgeGram_filter',
    value: {
        type: 'edgeNGram',
        min_gram: 2,
        max_gram: 20,
        token_chars: [
            'letter',
            'digit',
            'punctuation',
            'symbol'
        ]
    }
};

const $NGramFilter = {
    name: 'nGram_filter',
    value: {
        type: 'nGram',
        min_gram: 2,
        max_gram: 20,
        token_chars: [
            'letter',
            'digit',
            'punctuation',
            'symbol'
        ]
    }
};

const $BeiderMorseFilter = {
    name: 'beider_morse_filter',
    value: {
        type: 'phonetic',
        encoder: 'beider_morse',
        languageset: ['any']
    }
};

const $RefinedSoundexFilter = {
    name: 'refined_soundex_filter',
    value: {
        type: 'phonetic',
        encoder: 'refined_soundex'
    }
};

const $DoubleMetaphoneFilter = {
    name: 'double_metaphone_filter',
    value: {
        type: 'phonetic',
        encoder: 'double_metaphone',
        max_code_len: 6
    }
};

const customAnalyzer = (tokenizer, filters = [$LowercaseFilter]) =>
  ({type: 'custom', tokenizer: tokenizer.name, filter: _.map(filters, filter => filter.name)});

const standardAnalyzer = _.rest((filters) => customAnalyzer($StandardTokenizer, filters), 0);

export default {
    analyzer: {
        keyword_analyzer: customAnalyzer($KeywordTokenizer),
        whitespace_index_analyzer: customAnalyzer($WhitespaceTokenizer),
        standard_search_analyzer: standardAnalyzer($LowercaseFilter),
        standard_index_analyzer: standardAnalyzer($LowercaseFilter),
        nGram_index_analyzer: standardAnalyzer($LowercaseFilter, $NGramFilter),
        edgeGram_index_analyzer: standardAnalyzer($LowercaseFilter, $EdgeGramFilter),
        phonetic_bm_index_analyzer: standardAnalyzer($LowercaseFilter, $BeiderMorseFilter),
        phonetic_edgeGram_bm_index_analyzer: standardAnalyzer($LowercaseFilter, $PhoneticEdgeGramFilter, $BeiderMorseFilter),
        phonetic_bm_search_analyzer: standardAnalyzer($LowercaseFilter, $BeiderMorseFilter),
        phonetic_soundex_index_analyzer: standardAnalyzer($LowercaseFilter, $RefinedSoundexFilter),
        phonetic_edgeGram_soundex_index_analyzer: standardAnalyzer($LowercaseFilter, $PhoneticEdgeGramFilter, $RefinedSoundexFilter),
        phonetic_soundex_search_analyzer: standardAnalyzer($LowercaseFilter, $RefinedSoundexFilter),
        phonetic_dm_index_analyzer: standardAnalyzer($LowercaseFilter, $DoubleMetaphoneFilter),
        phonetic_edgeGram_dm_index_analyzer: standardAnalyzer($LowercaseFilter, $PhoneticEdgeGramFilter, $DoubleMetaphoneFilter),
        phonetic_dm_search_analyzer: standardAnalyzer($LowercaseFilter, $DoubleMetaphoneFilter)
    },
    filter: {
        [$NGramFilter.name]: $NGramFilter.value,
        [$PhoneticEdgeGramFilter.name]: $PhoneticEdgeGramFilter.value,
        [$EdgeGramFilter.name]: $EdgeGramFilter.value,
        [$BeiderMorseFilter.name]: $BeiderMorseFilter.value,
        [$RefinedSoundexFilter.name]: $RefinedSoundexFilter.value,
        [$DoubleMetaphoneFilter.name]: $DoubleMetaphoneFilter.value
    }
};
