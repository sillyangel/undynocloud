define(['amd/logger/queue','amd/sandbox'], function(Queue){

    if(window.filesystemLog){
        return window.filesystemLog;
    } else {
        var filesystemLog = {

            _fs: false,
            _initSuccessful: false,
            _logFile: false,
            _fileError: false,
            _msgQueue: false,
            _polling: false,
            _queueError: false,
            _writingToFile: false,
            MAX_FILES: 7,
            isFromToday : function(file){
                var today = new Date(),
                //we can do this because the name of the file is just new Date().toJSON();
                    fileDate = new Date(file.name.slice(0, -4));

                return fileDate.getDate() === today.getDate();
            },

            init: function () {
                return this.initFilesystem();
            },

            initFilesystem: function () {
                var _this = this;
                return new Promise(function(resolve, reject){
                    /**
                     * Request to filesystem on persistent local storage
                     */
                    window.webkitRequestFileSystem(PERSISTENT, 5 * 1024 * 1024 /*5MB*/, function (fs) {
                        _this._fs = fs;
                        _this.clearLog();
                        _this.initLogFile().then(function () {
                            window.filesystemLog = filesystemLog;
                            _this.initQueue().then(function () {
                                _this.__initSuccessful = true;
                                resolve();
                            });
                        });
                    }, function (e) {
                        _this.processError(e);
                        reject(e);
                    });
                });
            },

            initLogFile: function() {
                var _this = this;
                var logFileName = _this.getActualLogFilename();
                return _this.initFile(logFileName).then(function(file) {
                    _this._logFile = file;
                    return file;
                });
            },

            initFile: function(name) {
                return this.getFile(name, {create: true});
            },

            getFile: function(name, flags) {
                var _this = this;
                return new Promise(function(resolve, reject) {
                    if (!_this._fs) {
                        reject({message: 'File system not initialized.'});
                        return;
                    }

                    _this._fs.root.getFile(
                        name,
                        flags,
                        function(file) { resolve(file); },
                        function(e) { reject({error: e}); }
                    );
                });
            },

            initQueue: function () {
                var _this = this;
                return new Promise(function(resolve,reject) {
                   _this._msgQueue = new Queue();
                    if(_this._msgQueue) {
                        resolve();
                    } else {
                        _this._queueError = 'failed to create message queue';
                        reject({'error': _this._queueError});
                    }
                });
            },
            /** Test Function **/
            getQueue: function() {
              return this._msgQueue;
            },

            getLogFile: function() {
                var _this = this;

                return new Promise(function (resolve, reject) {
                    if (!(_this.__initSuccessful && typeof _this._logFile === "object"  )) {
                        reject({ "message": "File creation process failed !" });
                    }

                    if (!_this.isFromToday(_this._logFile)) {
                        _this.initLogFile().then(function (file) {
                            resolve(file);
                        }, function (error) {
                            console.warn(error);
                            reject({ "message": "File creation process failed !" });
                        });
                    }

                    resolve(_this._logFile);
                });
            },

            getLogFiles: function() {
                var _this = this;
                return $.Deferred(function(dfd) {
                    var reader = _this._fs.root.createReader();
                    reader.readEntries(
                        function(results) {
                            var files = results.filter(function(entry) {
                                return !entry.isDirectory &&
                                    entry.name.indexOf('.json') === -1;
                            });
                            dfd.resolve(files);
                        },
                        function(e) {
                            dfd.reject(e);
                        }
                    );
                });
            },

            logFileDate: function(file) {
                return new Date(file.name.slice(0, -4));
            },

            getFilesBetweenDates: function(d1, d2) {
                var _this = this;
                var date2 = new Date(d2);
                date2.setDate(date2.getDate() + 1);

                return _this.getLogFiles().then(
                    function(files) {
                        return files.filter(function(file) {
                            var date = _this.logFileDate(file);
                            return date >= d1 && date < date2;
                        });
                    },
                    function(e) {
                        _this.processError(e);
                        return $.Deferred(function(dfd) {
                            dfd.reject(e);
                        });
                    }
                );
            },

            clearLog: function() {
                var _this = this;
                if (typeof _this._fs !== 'object') { return; }

                _this.getLogFiles().then(
                    function(files) {
                        var now = new Date();
                        var weekOld = new Date().setDate(now.getDate() - 7);
                        files.sort(function(f1, f2) {
                            var date1 = _this.logFileDate(f1);
                            var date2 = _this.logFileDate(f2);
                            return date1 < date2 ? -1 : date2 < date1 ? 1 : 0;
                        });

                        files.forEach(function(file) {
                            var date = _this.logFileDate(file);
                            if (date < weekOld) {
                                file.remove(function() {
                                    console.info('File ' + file.name + ' removed.');
                                }, _this.processError);
                            }
                        });
                    },
                    _this.processError
                );
            },

            error: function (title, error) {
                return this.write(title, error.message);
            },

            log_enqueued_handler: function() {
                var _this = this;
                if(!_this.writingToFile && !_this._msgQueue.isEmpty()) {
                    var blob = _this._msgQueue.peek();
                    _this.writeToLog(blob).then(
                        function() {
                            _this._msgQueue.dequeue();
                            //console.debug('log msg dequeued');
                            _this.log_dequeued_handler();
                        },
                        function(e) {
                            console.warn("Error writing to log", e);
                        }
                    );
                }
            },

            log_dequeued_handler: function() {
                var _this = this;
                if(!_this.writingToFile && !_this._msgQueue.isEmpty()) {
                    var blob = _this._msgQueue.peek();
                    _this.writeToLog(blob).then(
                        function() {
                           _this._msgQueue.dequeue();
                            //console.debug('log msg dequeued');
                            _this.log_dequeued_handler();
                        },
                        function(e) {
                            console.warn("Error writing to log", e);
                        }
                    );
                }

            },

            writeToLog: function(blob) {
                var _this = this;
                _this.writingToFile = true;

                return this.getLogFile().then(
                    function(file) {
                        return _this.writeToFile(file, blob, true)
                        .then(
                            function() {
                                _this.writingToFile = false;
                                return Promise.resolve();
                            },
                            function(e) {
                                _this.writingToFile = false;
                                return Promise.reject(e);
                            }
                        );
                    },
                    function(e) {
                        _this.writingToFile = false;
                        return Promise.reject({
                            message: 'File writing process failed!'
                        });
                    }
                );
            },

            writeToFile: function(file, blob, append) {
                var _this = this;
                append = append === true;
                return new Promise(function(resolve, reject) {
                    file.createWriter(
                        function(writer) {
                            // `truncated` used only when not appending.
                            var truncated = false;
                            if (append) { writer.seek(writer.length); }

                            writer.onwriteend = function() {
                                if (append || truncated) {
                                    resolve();

                                // NB: If not appending, assume truncation is
                                //     required. This allows to easily clear
                                //     files that were longer than the written
                                //     data.
                                } else {
                                    truncated = true;
                                    writer.truncate(this.position);
                                }
                            };
                            writer.onerror = function (e) {
                                _this.processError('Write failed: ' + e.toString());
                                reject({message: 'File writing process failed! ' + e.toString()});
                            };

                            writer.write(blob);
                        },
                        function(e) {
                            _this.processError(e);
                            reject({message: 'File writing process failed!'});
                        }
                    );
                });
            },

            write: function (title, message) {
                var _this = this;
                //Make sure that we have a queue!
                if(!_this._msgQueue) {
                    _this._msgQueue = new Queue();
                }
                message = typeof message === "undefined" ? '' : message;
                message = typeof message === "object" ?  JSON.stringify(message) : message;
                // Create a new Blob and write it to log.txt.
                var data = [new Date().toString() + ": " + title + " - " + message + "\n"] , // Note: window.WebKitBlobBuilder in Chrome 12.
                    blob = new Blob(data, {type: "text/plain"});
                //console.log(data);
                _this._msgQueue.enqueue(blob);
                _this.log_enqueued_handler();
            },

            readFile: function(file, type) {
                var _this = this;
                type = type || 'text/plain';
                return new Promise(function(resolve, reject) {
                    file.file(
                        function(fileBlob) {
                            var reader = new FileReader();
                            reader.onloadend = function() {
                                if (reader.error) {
                                    _this.processError(reader.error);
                                    reject(reader.error);
                                } else {
                                    resolve(reader.result);
                                }
                            };
                            reader.readAsText(fileBlob, type);
                        },
                        function(e) {
                            _this.processError(e);
                            reject(e);
                        }
                    );
                });
            },

            readLastFileLogFile: function() {
                var _this = this;
                return new Promise(function(resolve, reject) {
                    if (!_this._logFile) {
                        reject({error: 'Log file not initialized.'});
                        return;
                    }
                    resolve(_this._logFile);
                }).then(_this.readFile);
            },

            getLastFileError: function () {
                return this._fileError;
            },

            getActualLogFilename: function () {
                var date = new Date();
                return date.toJSON() + ".txt";
            },

            processError: function (e) {
                console.warn(e);
            }
        };

        return filesystemLog;
    }
});