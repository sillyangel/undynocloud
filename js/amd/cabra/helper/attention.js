define([
    'amd/logger/logger', 'amd/sandbox', 'amd/helpers',
    'amd/windowKeepAliveManager', 'amd/windowKeepAlive'
], function(
    Logger, Sandbox, WindowHelper,
    WindowKeepAliveManager, WindowKeepAlive
) {
    var Attention = function () {
        var sandbox = new Sandbox().init();

        this.lockFlags = {
            kAttentionClear: 0,
            kAttentionScreen: 1,
            kAttentionMouse: 2,
            kAttentionKeyboard: 4
        };

        this.kioskMode = null;
        this.windowHelper = new WindowHelper();
        this._displaysBlocking = false;
        this._inputBlocking = false;

        this.message = "";
        this.details = "";

        this.setBlocking = function (flag, message, details) {
            var self = this,
                lockFlags = self.lockFlags;

            if (!message) {
                message = "";
            }

            if (!details) {
                details = "";
            }

            if (flag  == lockFlags.kAttentionClear) {
                Logger.info("Attention Cleared");
                self.message = "";
                self.details = "";
                self.setDisplaysBlocked(false);
                self.setInputsLocked(false);
            } else if ((flag == (lockFlags.kAttentionKeyboard + lockFlags.kAttentionMouse)) ||
                       (flag == lockFlags.kAttentionKeyboard) ||
                       (flag == lockFlags.kAttentionMouse)){
                Logger.info("Inputs Locked");
                self.message = "";
                self.details = "";
                self.setDisplaysBlocked(false);
                self.setInputsLocked(true);
            } else if ((flag == (lockFlags.kAttentionScreen + lockFlags.kAttentionKeyboard + lockFlags.kAttentionMouse)) ||
                       (flag == (lockFlags.kAttentionScreen + lockFlags.kAttentionKeyboard)) ||
                       (flag == (lockFlags.kAttentionScreen + lockFlags.kAttentionMouse)) ||
                       (flag == lockFlags.kAttentionScreen)) {
                Logger.info("Screen + Inputs Locked");
                self.message = message;
                self.details = details;
                if (!self.areDisplaysBlocked()) {
                    Logger.info("Attention Message set to ", message);
                    Logger.info("Detail set to ", details);
                    self.setDisplaysBlocked(true);
                    self.setInputsLocked(true);
                } else {
                    Logger.info("Updating Existing Message to ", message);
                    Logger.info("Updating Detail to ", details);
                    //Update message UI
                    sandbox.publish("attentionRequest", {message: self.message, details: self.details});
                }
            } else {
                Logger.error("Invalid Attention Setting, Clearing Attention if active");
                self.message = "";
                self.details = "";
                self.setDisplaysBlocked(false);
                self.setInputsLocked(false);
            }
        };

        this.areDisplaysBlocked = function () {
            return this._displaysBlocking;
        };

        this.setDisplaysBlocked = function (displaysBlocked) {
            var self = this;
            if (displaysBlocked) {
                if (self.areDisplaysBlocked() === false) {
                    Logger.info('Will add keep alive for attention');
                    self._displaysBlocking = true;
                    var args = ['../ui/views/cabras/attentionRequest.html'];
                    var openDialog = WindowKeepAlive.openPromise.bind(
                        WindowKeepAlive,
                        'attention', {message: self.message, details: self.details},
                        self.windowHelper.openFullscreen, self.windowHelper, args
                    );
                    var shouldBeOpen = WindowKeepAlive.shouldBeOpenPromise.bind(
                        WindowKeepAlive,
                        function() { return self.areDisplaysBlocked(); });

                    self.kioskMode = new WindowKeepAlive(openDialog, shouldBeOpen, 'isFullscreenAndFocused');
                    WindowKeepAliveManager.addKeepAlive(self.kioskMode, WindowKeepAliveManager.priority.required);
                }
            } else {
                if (self.areDisplaysBlocked()) {
                    self._displaysBlocking = false;
                    WindowKeepAliveManager.removeKeepAlive(self.kioskMode);
                }
            }
        };

        this.areInputsLocked = function () {
            return this._inputBlocking;
        };

        this.setInputsLocked = function (inputsLocked) {
            this._inputBlocking = inputsLocked;
        };
    };

    return Attention;
});