define(['amd/cabra/helper/thumbnailGeneral', 'amd/settings', 'amd/logger/logger'], function(ThumbnailGeneral, SETTINGS, Logger){
    var ThumbnailDesktop = function () {

        var _this = this;
        var timeoutId = false;
        var chooseDesktopMediaTimeoutId = false;
        this.video = false;
        this._chooseDesktopMediaRequestId = null;
        this._streamReady = false;
        this._activeThumbnailCount = 0;
        this._isStopNow = true;
        this._stream = false;


        this.init = function () {
            this.addThumbnail();
        };

        this.addThumbnail = function () {
            this._isStopNow = false;
            this._activeThumbnailCount++;
        };

        this.removeThumbnail = function() {
            this._activeThumbnailCount--;

            if (this._activeThumbnailCount === 0) {
                this._checkIfActiveThumbnailCabraExist();
            }
        };
        
        this.requestPermission = function () {
            if (!_this.isStreamReady() && !_this.hasPendingDesktopCaptureRequest()) {
                this._showUI();
            }
        };

        this._showUI = function() {
            if(!this.isStreamReady()) {
                if (!this.hasPendingDesktopCaptureRequest()) {
                    this._chooseDesktopMediaRequestId = chrome.desktopCapture.chooseDesktopMedia(["screen"], _this.desktopAccessApproved);
                    chooseDesktopMediaTimeoutId = setTimeout(function () {
                        if (_this.hasPendingDesktopCaptureRequest()) {
                            chrome.desktopCapture.cancelChooseDesktopMedia(_this._chooseDesktopMediaRequestId);
                        }
                        _this.desktopAccessApproved(null);
                    }, 15000);
                }
            } else {
                //the stream is still around
                _this.desktopAccessApproved(_this._stream);
            }
        };

        this.hasPendingDesktopCaptureRequest = function () {
            return (_this._chooseDesktopMediaRequestId);  
        };
        
        this.isStreamReady = function() {
            return this._streamReady;
        };

        this.desktopAccessApproved = function (stream) {
            //if they select a screen to share, process that stream
            Logger.debug('Desktop Access Approved streamid is : ' + stream);
            _this._chooseDesktopMediaRequestId = null;
            if(chooseDesktopMediaTimeoutId){
                window.clearTimeout(chooseDesktopMediaTimeoutId);
                chooseDesktopMediaTimeoutId = null;
            }
            
            if (stream) {
                Logger.debug('Preparing to process stream.');
                _this._processStreamId(stream);
                return true;
            }
            //if they press cancel, show the UI again, as long as we aren't stopped and there are active thumbnails sessions
            if(!_this._isStopNow && _this._activeThumbnailCount > 0) {
                _this._showUI();
            }
        };


        /**
         * Check If exist active cabra thumbnail in 90 minutes
         * @private
         */
        this._checkIfActiveThumbnailCabraExist = function () {
            //if a session ends, keep the stream open for 90 minutes
            var second = 1000,
                minute = 60 * second,
                timeout = 90 * minute;
            if(timeoutId){
                window.clearTimeout(timeoutId);
                timeoutId = false;
            }
            timeoutId = setTimeout(function () {
                if (_this._activeThumbnailCount === 0) {
                    _this._isStopNow = true;
                    _this.stop();
                }
            }, timeout);
        };

        this._processStreamId = function (stream) {
            if(stream === _this._stream) { //reuising our old stuff so don't make new.
                Logger.debug('We still have our old stream so not asking for permission');
                return true;
            }
            Logger.debug('Processing Stream ID');
            navigator.webkitGetUserMedia({
                audio: false,
                video: {
                    mandatory: {
                        maxWidth:2560,
                        maxHeight:1920,
                        chromeMediaSource: "desktop",
                        chromeMediaSourceId: stream
                    }
                }
            }, _this._gotStream, _this._getUserMediaError);
            return true;
        };

        this._gotStream = function (stream) {
            Logger.debug('Successfully got stream');
            _this._stream = stream;
            _this.video = document.getElementById('video');

            Logger.log('this.video is:' + _this.video);
            _this.video.src = window.URL.createObjectURL(stream);
            _this.video.play();
            _this._streamReady = true;
            stream.onended = _this._onEndStreamObserver;
        };

        this._getUserMediaError = function () {
            /**
             * todo Send message about error and close
             * @type {Array}
             */
            var args = Array.prototype.slice.call(arguments);
            Logger.warn('Error getting user media', args);
            _this._showUI();
        };

        this._onEndStreamObserver = function () {
            _this._streamReady = false;
            if (!_this._isStopNow) {
                _this._showUI();
            }
        };

        this.stop = function() {
            this._streamReady = false;
            this._stopStream();
        };

        this._stopStream = function() {
            if (this._stream) {
                var track = this._stream.getVideoTracks()[0];
                if (track && track.readyState === "live") {
                    track.stop();
                }
                this.stream = false;
            }
        };

        this._getScreenshot = function (width, height) {
            if (!_this._isStopNow && _this._streamReady) {
                var canvas = document.getElementById('canvas'),
                    ctx = canvas.getContext('2d'),
                    dataUrl;


                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(_this.video, 0, 0, width, height);
                dataUrl = canvas.toDataURL(SETTINGS.THUMBNAIL.MIMETYPE, 1);
                return new Promise(function (resolve, reject) {
                    _this.getImageBlob(dataUrl, width, height, resolve, reject);
                });
            }
            return false;
        };
    };

    extend(ThumbnailDesktop, ThumbnailGeneral);

    return ThumbnailDesktop;
});


//1. yes keep as singleton and share between cabra instances as needed
//2. dont tear down when broadcast ends (tear down after a timeout of 5 min)
//3. dont check state at start -> check at first thumnbnail start
//4. try to keep thumbnailDesktop running (if stream closes, open it again ask permission if needed)