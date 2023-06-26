define([], function(){
    var SETTINGS = {
        DYDEV: {
            CORE_SERVER: "https://api.dyknow.me/",
            OAUTH: {
                SERVER: "https://oauth.dyknow.me/",
                REQUEST: {
                    "grant_type": "http://api.dyknow.com/grant_types/tacet",
                    "username": "",
                    "customer_token": "",
                    "device_token": "",
                    "mac_addresses": "",
                    "hostname": ""
                },
                HEADER: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Basic M1NOOHhDZmNMdlhBam5PYk8wYlI6RTR6czVvWkF6MXJ6QXZBeWVPaTM='
                }
            },
            RULE_TO_CONST: "broadcaster"
        },
        AUTH_TYPE: {
            GOOGLE: "GOOGLE",
            FORM: "FORM"
        },
        EVENTS: {
            "OPEN_OBJECT": "open_object",
            "NEW_OBJECT": "new_object",
            "BROADCAST_END": "broadcast_end",
            "CALL_AUTH_NOTICE_FORM": "call_auth_notice_form",
            "AUTH_NOTICE_ACCEPTED": "auth_notice_accepted",
            "CALL_LOGIN_FORM": "call_login_form",
            "FORM_LOGIN": "do_form_login",
            "SIGN_IN": "sign_in",
            "SIGN_OUT": "sign_out",
            "START_TEST_APP_BLOCK": "start_test_app_block",
            "DID_DETACH_FROM_ALL_BROADCAST" : "did_detach_from_all_broadcast",
            "CORE_CLIENT_STOPS" : "core_client_stops",
            "IDENTITY_INVALID" : "identity_invalid",
            "FATAL_ERROR": "fatal_error_occurred",
            "GOOGLE_LOGIN": "login_with_google",
            "LOG_IN_SUCCESS": "login_success",
            "LOG_IN_ERROR": "login_error",
            "LOG_IN_FORM_READY": "login_ready",
            "CORE_CLIENT_STATE_CHANGED": "core_client_state_changed"
        },
        STORAGE : {
            OAUTH: 'oauth',
            SCHOOL: 'school'
        },
        BROADCASTSTATUS : {
            OPEN: "open"
        },
        THUMBNAIL : {
            SOURCE : {
                UNAVAILABLE: 'unavailable',
                DESKTOP: 'desktop',
                TAB: 'tab',
                CHROMEPROTECTED: "chromeprotected",
                CHROMEBLOCKED: "chromeblocked"
            },
            MIMETYPE : "image/jpeg"
        },
        APPBLOCKING : {
            RULES : {
                WHITELIST: 'whitelist',
                BLACKLIST: 'blacklist'
            }
        },
        APPLICATION : {
            TYPE : {
                WEB: 'web',
                APPLICATION: 'application'
            }
        },
        OS : {
            TYPES : ['windows', 'mac', 'ios', 'chrome']
        },
        STORAGE_KEY: "auth",
        DEFAULT_RETRY_OPTIONS :{
            times:3,
            statusCodes: [500, 501, 502, 503, 504, 505]
        },
        HOSTNAMES : ["dyknow.me", "dydev.me"],
        APPID: "kmpjlilnemjciohjckjadmgmicoldglf"
    };

    return SETTINGS;
});