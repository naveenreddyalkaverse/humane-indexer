// jscs:disable requireCamelCaseOrUpperCaseIdentifiers
const _ = require('lodash');

const $LowercaseFilter = {name: 'lowercase'};
const $StopFilter = {name: 'stop'};
const $StandardTokenizer = {name: 'standard'};
const $KeywordTokenizer = {name: 'keyword'};
const $WhitespaceTokenizer = {name: 'whitespace'};

// const $PhoneticEdgeGramFilter = {
//     name: 'phonetic_edgeGram_filter',
//     value: {
//         type: 'edgeNGram',
//         min_gram: 1,
//         max_gram: 20,
//         token_chars: [
//             'letter',
//             'digit',
//             'punctuation',
//             'symbol'
//         ]
//     }
// };

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

// const $NGramFilter = {
//     name: 'nGram_filter',
//     value: {
//         type: 'nGram',
//         min_gram: 2,
//         max_gram: 20,
//         token_chars: [
//             'letter',
//             'digit',
//             'punctuation',
//             'symbol'
//         ]
//     }
// };

const $HumaneEdgeGramFilter = {
    name: 'humane_edgeGram_filter',
    value: {
        type: 'humane_edgeGram',
        min_gram: 2,
        max_gram: 20,
        // payload: false,
        // prefix: 'e#',
        token_chars: [
            'letter',
            'digit',
            'punctuation',
            'symbol'
        ]
    }
};

const $HumaneEdgeGramWithPayloadFilter = {
    name: 'humane_edgeGram_with_payload_filter',
    value: {
        type: 'humane_edgeGram',
        min_gram: 2,
        max_gram: 20,
        payload: true,
        prefix: '',
        token_chars: [
            'letter',
            'digit',
            'punctuation',
            'symbol'
        ]
    }
};

const $RefinedSoundexFilter = {
    name: 'refined_soundex_filter',
    value: {
        type: 'phonetic',
        encoder: 'refined_soundex'
    }
};

const $DMSoundexFilter = {
    name: 'dm_soundex_filter',
    value: {
        type: 'phonetic',
        encoder: 'daitch_mokotoff'
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

const $DoubleMetaphoneFilter = {
    name: 'double_metaphone_filter',
    value: {
        type: 'phonetic',
        encoder: 'double_metaphone',
        max_code_len: 6
    }
};

//
// const $BigramShingleFilter = {
//     name: 'bigram_shingle_filter',
//     value: {
//         type: 'shingle',
//         max_shingle_size: 2,
//         min_shingle_size: 2,
//         output_unigrams: false,
//         output_unigrams_if_no_shingles: false,
//         token_separator: '_'
//     }
// };
//
// const $TrigramShingleFilter = {
//     name: 'trigram_shingle_filter',
//     value: {
//         type: 'shingle',
//         max_shingle_size: 3,
//         min_shingle_size: 3,
//         output_unigrams: false,
//         output_unigrams_if_no_shingles: false,
//         token_separator: '_'
//     }
// };

const $HumaneTokenFilter = {
    name: 'humane_token_filter',
    value: {
        type: 'humane'
    }
};

const $EdgeGramPrefixTokenFilter = {
    name: 'edge_gram_prefix_token_filter',
    value: {
        type: 'prefix',
        value: 'e#'
    }
};

const $RefinedSoundexPrefixTokenFilter = {
    name: 'refined_soundex_prefix_token_filter',
    value: {
        type: 'prefix',
        value: 'rs#'
    }
};

const $DMSoundexPrefixTokenFilter = {
    name: 'dm_soundex_prefix_token_filter',
    value: {
        type: 'prefix',
        value: 'ds#'
    }
};

const $BMPrefixTokenFilter = {
    name: 'bm_prefix_token_filter',
    value: {
        type: 'prefix',
        value: 'bm#'
    }
};

const $DMPrefixTokenFilter = {
    name: 'dm_prefix_token_filter',
    value: {
        type: 'prefix',
        value: 'dm#'
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
        
        // standard_bigram_shingles_index_analyzer: standardAnalyzer($LowercaseFilter, $BigramShingleFilter),
        // standard_trigram_shingles_index_analyzer: standardAnalyzer($LowercaseFilter, $TrigramShingleFilter),
        // nGram_index_analyzer: standardAnalyzer($LowercaseFilter, $NGramFilter),
        
        edgeGram_index_analyzer: standardAnalyzer($LowercaseFilter, $EdgeGramFilter),
        
        // phonetic_bm_index_analyzer: standardAnalyzer($LowercaseFilter, $BeiderMorseFilter),
        // phonetic_bm_bigram_shingles_index_analyzer: standardAnalyzer($LowercaseFilter, $BeiderMorseFilter, $BigramShingleFilter),
        // phonetic_bm_trigram_shingles_index_analyzer: standardAnalyzer($LowercaseFilter, $BeiderMorseFilter, $TrigramShingleFilter),
        // phonetic_edgeGram_bm_index_analyzer: standardAnalyzer($LowercaseFilter, $PhoneticEdgeGramFilter, $BeiderMorseFilter),
        // phonetic_bm_search_analyzer: standardAnalyzer($LowercaseFilter, $BeiderMorseFilter),
        // phonetic_soundex_index_analyzer: standardAnalyzer($LowercaseFilter, $RefinedSoundexFilter),
        // phonetic_soundex_bigram_shingles_index_analyzer: standardAnalyzer($LowercaseFilter, $RefinedSoundexFilter, $BigramShingleFilter),
        // phonetic_soundex_trigram_shingles_index_analyzer: standardAnalyzer($LowercaseFilter, $RefinedSoundexFilter, $TrigramShingleFilter),
        // phonetic_edgeGram_soundex_index_analyzer: standardAnalyzer($LowercaseFilter, $PhoneticEdgeGramFilter, $RefinedSoundexFilter),
        // phonetic_soundex_search_analyzer: standardAnalyzer($LowercaseFilter, $RefinedSoundexFilter),
        // phonetic_dm_index_analyzer: standardAnalyzer($LowercaseFilter, $DoubleMetaphoneFilter),
        // phonetic_dm_bigram_shingles_index_analyzer: standardAnalyzer($LowercaseFilter, $DoubleMetaphoneFilter, $BigramShingleFilter),
        // phonetic_dm_trigram_shingles_index_analyzer: standardAnalyzer($LowercaseFilter, $DoubleMetaphoneFilter, $TrigramShingleFilter),
        // phonetic_edgeGram_dm_index_analyzer: standardAnalyzer($LowercaseFilter, $PhoneticEdgeGramFilter, $DoubleMetaphoneFilter),
        // phonetic_dm_search_analyzer: standardAnalyzer($LowercaseFilter, $DoubleMetaphoneFilter),

        humane_did_you_mean_builder_analyzer: standardAnalyzer($LowercaseFilter, $StopFilter/*, $HumaneEdgeGramWithPayloadFilter*/),
        
        humane_analyzer: standardAnalyzer($LowercaseFilter, $HumaneEdgeGramFilter, $HumaneTokenFilter), // TODO: later it would be removed

        // TODO: generate bigrams... mixed with edgeGram
        
        // humane_edgeGram_analyzer: standardAnalyzer($LowercaseFilter, $HumaneEdgeGramFilter, $HumaneTokenFilter),
        
        standard_edgeGram_search_analyzer: standardAnalyzer($LowercaseFilter, $EdgeGramPrefixTokenFilter),
        
        phonetic_bm_search_analyzer: standardAnalyzer($LowercaseFilter, $BeiderMorseFilter, $BMPrefixTokenFilter),
        phonetic_dm_search_analyzer: standardAnalyzer($LowercaseFilter, $DoubleMetaphoneFilter, $DMPrefixTokenFilter),
        phonetic_refined_soundex_search_analyzer: standardAnalyzer($LowercaseFilter, $RefinedSoundexFilter, $RefinedSoundexPrefixTokenFilter),
        phonetic_dm_soundex_search_analyzer: standardAnalyzer($LowercaseFilter, $DMSoundexFilter, $DMSoundexPrefixTokenFilter),

        phonetic_bm_edgeGram_search_analyzer: standardAnalyzer($LowercaseFilter, $BeiderMorseFilter, $EdgeGramPrefixTokenFilter, $BMPrefixTokenFilter),
        phonetic_dm_edgeGram_search_analyzer: standardAnalyzer($LowercaseFilter, $DoubleMetaphoneFilter, $EdgeGramPrefixTokenFilter, $DMPrefixTokenFilter),
        phonetic_refined_soundex_edgeGram_search_analyzer: standardAnalyzer($LowercaseFilter, $RefinedSoundexFilter, $EdgeGramPrefixTokenFilter, $RefinedSoundexPrefixTokenFilter),
        phonetic_dm_soundex_edgeGram_search_analyzer: standardAnalyzer($LowercaseFilter, $DMSoundexFilter, $EdgeGramPrefixTokenFilter, $DMSoundexPrefixTokenFilter)
    },
    filter: {
        // [$NGramFilter.name]: $NGramFilter.value,
        // [$PhoneticEdgeGramFilter.name]: $PhoneticEdgeGramFilter.value,
        [$EdgeGramFilter.name]: $EdgeGramFilter.value,
        [$RefinedSoundexFilter.name]: $RefinedSoundexFilter.value,
        [$DMSoundexFilter.name]: $DMSoundexFilter.value,
        [$BeiderMorseFilter.name]: $BeiderMorseFilter.value,
        [$DoubleMetaphoneFilter.name]: $DoubleMetaphoneFilter.value,

        [$EdgeGramPrefixTokenFilter.name]: $EdgeGramPrefixTokenFilter.value,
        [$RefinedSoundexPrefixTokenFilter.name]: $RefinedSoundexPrefixTokenFilter.value,
        [$DMSoundexPrefixTokenFilter.name]: $DMSoundexPrefixTokenFilter.value,
        [$BMPrefixTokenFilter.name]: $BMPrefixTokenFilter.value,
        [$DMPrefixTokenFilter.name]: $DMPrefixTokenFilter.value,

        [$HumaneEdgeGramFilter.name]: $HumaneEdgeGramFilter.value,
        [$HumaneEdgeGramWithPayloadFilter.name]: $HumaneEdgeGramWithPayloadFilter.value,
        
        // [$BigramShingleFilter.name]: $BigramShingleFilter.value,
        // [$TrigramShingleFilter.name]: $TrigramShingleFilter.value,
        
        [$HumaneTokenFilter.name]: $HumaneTokenFilter.value
    }
};
