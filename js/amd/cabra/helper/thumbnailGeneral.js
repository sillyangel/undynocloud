define([
    'amd/settings', 'amd/logger/logger'
], function(
    SETTINGS, Logger
){
    var ThumbanilGeneral = function () {

        var _this = this;

        this.PARAMETERS = {
            WIDTH: screen.width/12,
            HEIGHT: screen.height/12,
            ASPECT_RATIO: 1.09
        };

        this.getImageBlob = function (dataUrl, width, height, resolve, reject) {
            if(!dataUrl){
                reject();
                return;
            } else if (dataUrl === SETTINGS.THUMBNAIL.SOURCE.CHROMEPROTECTED|| 
                dataUrl === SETTINGS.THUMBNAIL.SOURCE.CHROMEBLOCKED){
                reject(dataUrl);
                return;
            }

            try {
                var img = new Image(),
                    _this = this;

                img.src = dataUrl;
                img.onload = function () {
                    _this._imageToBlob(img, width, height, resolve);
                };
            } catch (e) {
                Logger.error(e.message, e.stack);
                reject();
            }
        };

        this.withScale = function (scale) {

            var width = this.PARAMETERS.WIDTH,
                height = this.PARAMETERS.HEIGHT;

            if (scale > 1) {
                width = width * scale;
                height = height * scale;
            }

            return this._getScreenshot(width, height);
        };

        this._imageToBlob = function (img, width, height, resolve) {

            /// create an off-screen canvas
            if(!img.src){
                resolve(img.src);
            }

            var _this = this,
                canvas = document.getElementById('canvas'),
                ctx = canvas.getContext('2d'),
                currentAspectRatio = img.width / img.height;

            if (img.width / img.height < _this.PARAMETERS.ASPECT_RATIO) {
                width = height * currentAspectRatio;
            } else {
                height = width / currentAspectRatio;
            }

            /// set its dimension to target size
            canvas.width = width;
            canvas.height = height;

            /// draw source image into the off-screen canvas:
            ctx.drawImage(img, 0, 0, width, height);

            /// encode image to data-uri with base64 version of compressed image
            return canvas.toBlob(function (blob) {
                resolve(blob);
            }, SETTINGS.THUMBNAIL.MIMETYPE);
        };

    };

    return ThumbanilGeneral;
});