define(['amd/filesystem'], function(filesystemLog){
    var Logger = {

        log: function (title, message) {
            window.console.log.apply( console, arguments );
            if(typeof title !== "string"){
                filesystemLog.write("Log", title);
            } else {
                filesystemLog.write(title, message);
            }
        },

        debug : function (title, message) {
            window.console.debug.apply( console, arguments );
            if(typeof title !== "string"){
                filesystemLog.write("Debug", title);
            } else {
                filesystemLog.write(title, message);
            }
        },

        info : function (title, message) {
            window.console.info.apply( console, arguments );
            if(typeof title !== "string"){
                filesystemLog.write("Info", title);
            } else {
                filesystemLog.write(title, message);
            }
        },

        warn : function (title, message) {
            window.console.warn.apply( console, arguments );
            if(typeof title !== "string"){
                filesystemLog.write("Warn", title);
            } else {
                filesystemLog.write(title, message);
            }
        },

        error : function( msg, stack ) {
            window.console.error.apply( console, arguments );
            filesystemLog.error( "SystemError", { "message" : msg });
        }
    };

    return Logger;
});