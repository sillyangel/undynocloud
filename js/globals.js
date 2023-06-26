define(['amd/settings', 'amd/logger/logger'], function(SETTINGS, Logger){
    /**
     * Function that makes inheritance easy
     * @param class Child
     * @param class Parent
     */
    window.extend = function(Child, Parent) {
        Child.prototype = new Parent();
        Child.prototype.constructor = Child;
//     Child.superclass = Parent.prototype;
    };

    /**
     * Helper to extends objects
     * @param destination
     * @param source
     * @returns {*}
     */
    Object.extend = function (destination, source) {
        var property;
        for (property in source) {
            if (source.hasOwnProperty(property)) {
                destination[property] = source[property];
            }
        }
        return destination;
    };


    /**
     * Rewrited error class
     * @param string message
     * @constructor
     */
    window.SystemError = function( message ) {
        this.constructor.prototype.__proto__ = Error.prototype;
        Error.captureStackTrace(this, this.constructor);
        this.name = this.constructor.name;
        this.message = message;

        Logger.error(this.name + ' : ' + this.message, this.stack);
    };

    window.isArrayFunc = function( obj ) {
        if( Object.prototype.toString.call( obj ) === '[object Array]' ) {
            return true;
        }
        return false;
    };

    Array.prototype.first = function () {
        return this[0];
    };

    window.getRealObjLength = function(obj) {

        if (typeof obj !== "object") {
            return 0;
        }
        return Object.keys(obj).length;
    };

    /**
     * Extends for plugin jquery.ba-tinypubsub
     */
    (function ($) {
        // "topic" holder
        var o = $({});

        // attach each alias method
        $.each({on:0,off:0,"trigger":0}, function(alias,method) {
            $[alias] = function(topic, callbackOrArgs) {
                o[method || alias].apply(o, arguments);
            }
        });

    })(jQuery);

    /**
     * Transform text in camel case
     * @returns {string}
     */
    String.prototype.camelize = function () {
        return this.replace (/(?:[_])(\w)/g, function (_, c) {
            return c ? c.toUpperCase () : '';
        })
    };

    /**
     * Returns true if key is not a key in object or object[key] has
     * value undefined. If key is a dot-delimited string of key names,
     * object and its sub-objects are checked recursively.
     */
    window.isUndefinedKey = function(object, key) {
        var keyChain = Array.isArray(key) ? key : key.split('.'),
            objectHasKey = keyChain[0] in object,
            keyHasValue = typeof object[keyChain[0]] !== 'undefined';

        if (objectHasKey && keyHasValue) {
            if (keyChain.length > 1) {
                return isUndefinedKey(object[keyChain[0]], keyChain.slice(1));
            }

            return false;
        }
        else {
            return true;
        }
    };


    /**
     * This script sets OSName variable as follows:
     *  "Windows"    for all versions of Windows
     *  "MacOS"      for all versions of Macintosh OS
     *  "CrOS"       for all versions of Chrome OS
     *  "Linux"      for all versions of Linux
     *  "UNIX"       for all other UNIX flavors
     *  FALSE indicates failure to detect the OS
     * @returns {boolean || string}
     */
    window.detectOS = function(){

        if (navigator.appVersion.indexOf("CrOS")!=-1){
            return "Chrome OS";
        }
        if (navigator.appVersion.indexOf("Win")!=-1) {
            return "Windows";
        }
        if (navigator.appVersion.indexOf("Mac")!=-1){
            return "MacOS";
        }

        if (navigator.appVersion.indexOf("X11")!=-1){
            return "UNIX";
        }

        if (navigator.appVersion.indexOf("Linux")!=-1) {
            return "Linux";
        }

        return false;
    };

    /**
     *
     * @param obj
     * @returns {boolean}
     */
    window.isEmptyObj = function(obj){
        return (Object.getOwnPropertyNames(obj).length === 0);
    }
});