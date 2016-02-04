// jscs:disable requireCamelCaseOrUpperCaseIdentifiers
export const $Keyword = {
    type: 'string',
    analyzer: 'keyword_analyzer'
};

export const $VernacularKeyword = {
    type: 'string',
    analyzer: 'keyword_analyzer'
};

export const $Long = {
    type: 'long'
};

export const $NotIndexedLong = {
    type: 'long',
    index: 'no',
    include_in_all: false
};

export const $Double = {
    type: 'double'
};

export const $Boolean = {
    type: 'boolean'
};

export const $Date = {
    type: 'date',
    format: 'yyyy-MM-dd HH:mm:ss||epoch_millis'
};

export const $NotIndexedText = {
    type: 'string',
    index: 'no',
    include_in_all: false
};

export const $IdentityText = {
    type: 'string',
    index: 'not_analyzed'
};

export const $Text = {
    type: 'string',
    analyzer: 'standard_index_analyzer',
    search_analyzer: 'standard_search_analyzer',
    fields: {
        raw: $Keyword,
        edgeGram: {
            type: 'string',
            analyzer: 'edgeGram_index_analyzer',
            search_analyzer: 'standard_search_analyzer'
        },
        nGram: {
            type: 'string',
            analyzer: 'nGram_index_analyzer',
            search_analyzer: 'standard_search_analyzer'
        },
        phonetic_bm: {
            type: 'string',
            analyzer: 'phonetic_bm_index_analyzer',
            search_analyzer: 'phonetic_bm_search_analyzer'
        },
        phonetic_edgeGram_bm: {
            type: 'string',
            analyzer: 'phonetic_edgeGram_bm_index_analyzer',
            search_analyzer: 'phonetic_bm_search_analyzer'
        },
        phonetic_soundex: {
            type: 'string',
            analyzer: 'phonetic_soundex_index_analyzer',
            search_analyzer: 'phonetic_soundex_search_analyzer'
        },
        phonetic_edgeGram_soundex: {
            type: 'string',
            analyzer: 'phonetic_edgeGram_soundex_index_analyzer',
            search_analyzer: 'phonetic_soundex_search_analyzer'
        },
        phonetic_dm: {
            type: 'string',
            analyzer: 'phonetic_dm_index_analyzer',
            search_analyzer: 'phonetic_dm_search_analyzer'
        },
        phonetic_edgeGram_dm: {
            type: 'string',
            analyzer: 'phonetic_edgeGram_dm_index_analyzer',
            search_analyzer: 'phonetic_dm_search_analyzer'
        }
    }
};

export const $VernacularText = {
    type: 'string',
    analyzer: 'standard_index_analyzer',
    search_analyzer: 'standard_search_analyzer',
    include_in_all: false
};

//export const $AutocompletableText = {
//    type: 'string',
//    analyzer: 'standard_index_analyzer',
//    search_analyzer: 'standard_search_analyzer',
//    fields: {
//        raw: $Keyword,
//        edgeGram: {
//            type: 'string',
//            analyzer: 'edgeGram_index_analyzer',
//            search_analyzer: 'standard_search_analyzer'
//        },
//        nGram: {
//            type: 'string',
//            analyzer: 'nGram_index_analyzer',
//            search_analyzer: 'standard_search_analyzer'
//        },
//        phonetic_bm: {
//            type: 'string',
//            analyzer: 'phonetic_bm_index_analyzer',
//            search_analyzer: 'phonetic_bm_search_analyzer'
//        },
//        phonetic_edgeGram_bm: {
//            type: 'string',
//            analyzer: 'phonetic_edgeGram_bm_index_analyzer',
//            search_analyzer: 'phonetic_bm_search_analyzer'
//        },
//        phonetic_soundex: {
//            type: 'string',
//            analyzer: 'phonetic_soundex_index_analyzer',
//            search_analyzer: 'phonetic_soundex_search_analyzer'
//        },
//        phonetic_edgeGram_soundex: {
//            type: 'string',
//            analyzer: 'phonetic_edgeGram_soundex_index_analyzer',
//            search_analyzer: 'phonetic_soundex_search_analyzer'
//        },
//        phonetic_dm: {
//            type: 'string',
//            analyzer: 'phonetic_dm_index_analyzer',
//            search_analyzer: 'phonetic_dm_search_analyzer'
//        },
//        phonetic_edgeGram_dm: {
//            type: 'string',
//            analyzer: 'phonetic_edgeGram_dm_index_analyzer',
//            search_analyzer: 'phonetic_dm_search_analyzer'
//        },
//        autocomplete_edgeGram: {
//            type: 'string',
//            analyzer: 'autocomplete_index_analyzer',
//            search_analyzer: 'autocomplete_search_analyzer'
//        }
//    }
//};