define([], function(){
    var DeviceInformation = function(){
        var platformInfo = {};

        this.getDeviceInformation = function(){

        };

        this._getHostName = function (){
            return '';
        };

        this._getOSType = function()
        {
            var arch = platformInfo.arch;
            if(arch === "x86-32"){
                return 5;
            } else if(arch === "x86-64" ) {
                return 6;
            } else if(arch === "arm" ) {
                return 7;
            }
        };

        this._getOSDescription = function(){
            return window.navigator.userAgent;
        };

        this._getKernelVersion = function (){
            return '';
        };

        this._getMachineName = function (){
            return '';
        };

        this._getMachineModel = function(){
            return '';
        };

        this._getCurrentLocale = function(){
            return '';
        };

        this._getCPUType = function(){
            return '';
        };

        this._getProcessorSpeed = function(){
            return '';
        };

        this._getNumberOfProcessors = function(){
            return 0;
        };

        this._getPhysicalMemory = function(){
            var physicalMemory = 0;
            chrome.system.memory.getInfo(function (memory){
                physicalMemory = (memory.capacity/1024/1024/1024)+"GB";
             });
            return physicalMemory;
        };

        this._getUserMemory = function(){
            var availableMemory = 0;
            chrome.system.memory.getInfo(function (memory){
                availableMemory = (memory.availableCapacity/1024/1024/1024)+"GB";
             });

            return availableMemory;
        };

        this._getVideoAdapter = function(){
            return '';
        };

        this._getVideoMemory = function(){
            return 0;
        };

        this._getMonitors= function(){
            return [];
        };

        this._getNetworkDevices = function(){
            return [];
        };

        chrome.runtime.getPlatformInfo(function(pi){
            platformInfo = pi;
        });

    };
    return DeviceInformation;
});