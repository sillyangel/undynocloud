define([
    'amd/cabra/attentionSession.events','amd/logger/logger', 'amd/sandbox',
    'amd/windowKeepAliveManager', 'amd/windowKeepAlive',
    'underscore', 'linkify'
], function(
    attentionEvents, Logger, Sandbox,
    WindowKeepAliveManager, WindowKeepAlive,
    _, linkify
) {
    var Messages = function () {
        var sandbox = new Sandbox().init();

        this.messagesDialog = null;

        //List of Unacknowledged messages
        //Maintaining this list here as well as at the UI layer because we do not have guarentees on the lifecycle of the UI Layer
        //And may need to restore "state" at the ui layer because the window was closed etc.
        this.messages = [
            /*{ conversationId: <guid>, message: <string>, open_urls: <bool> }*/
        ];

        this.showDialog = function() {
            var self = this;
            var openDialog = WindowKeepAlive.openPopupPromise.bind(
                WindowKeepAlive,
                'messages', {messages: self.messages},
                '../ui/views/cabras/messagesRequest.html', 370, 100
            );
            var shouldBeOpen = WindowKeepAlive.shouldBeOpenPromise.bind(
                WindowKeepAlive,
                function() { return self.messages.length > 0; });

            if (!self.messagesDialog) {
                Logger.info('Will add keep alive for messages');
                self.messagesDialog = new WindowKeepAlive(openDialog, shouldBeOpen, 'isOpened', 'open');
                WindowKeepAliveManager.addKeepAlive(self.messagesDialog, WindowKeepAliveManager.priority.low);
            }
        };

        this.hideDialog = function () {
            var self = this;
            if (self.messagesDialog) {
                WindowKeepAliveManager.removeKeepAlive(self.messagesDialog);
                self.messagesDialog = null;
            }
        };

        this.findMessageByConversationId = function (/*guid*/ conversationId) {
            if (!conversationId) {
                throw new SystemError("Cannot call findMessageByConversationId without a conversationId");
            }
            var self = this;
            return self.messages.filter(function (message) {
                return message.conversationId == conversationId;
            })[0];
        };

        /**
         * Add a message to be displayed.
         * @param {string} conversationId A non-optional conversation GUID.
         * @param {string} message A non-optional message to display.
         * @param {bool} openUrls If any URLs should be opened.
         * @param {string} teacher The teacher name for the message.
         */
        this.addMessage = function(conversationId, message, openUrls, teacher) {
            if (!conversationId) {
                throw new SystemError("Cannot call addMessage without a conversationId");
            }
            if (!message) {
                throw new SystemError("Cannot call addMessage without a message");
            }

            var newMessage = {
                conversationId: conversationId,
                message: message,
                open_urls: openUrls,
                teacher: teacher
            };
            this.messages.unshift(newMessage);

            if (!this.messagesDialog) {
                this.showDialog();
            } else {
                //Publish Event to Add Message to UI if UI already exists
                sandbox.publish('messagesRequestRealtime', newMessage);
            }

            // Open any URLs, if desired.
            if (newMessage.open_urls === true) {
                this.openUrls(newMessage);
            }
        };

        /**
         * Parse message for urls and open each url.
         */
        this.openUrls = function(newMessage) {
            //TODO: read from file
            var urls = linkify.find(newMessage.message);
            if (!urls.length) { return; }

            //prevent duplicate URLs from being opened more than once
            var hrefs = _.pluck(urls, "href");
            var uniqueURLs = _.unique(hrefs);
            chrome.storage.local.get(newMessage.conversationId, function(res) {
                var urls_to_open;
                if (res && _.keys(res).length !== 0) {
                    Logger.debug('got opened urls back from local storage.');
                    urls_to_open = _.difference(uniqueURLs, res[newMessage.conversationId].urls);
                } else {
                    Logger.debug("didn't find any opened urls in local storage.");
                    urls_to_open = uniqueURLs;
                }
                //open each unique URL
                //uniqueURLs
                urls_to_open.forEach(function (url) {
                    window.open(url);
                });
                //only write if we don't already exist
                if (urls_to_open && urls_to_open.length > 0) {
                    //TODO: write to file
                    var obj = {};
                    var today = new Date();
                    obj[newMessage.conversationId] = {'date':today.toLocaleString(),'urls': urls_to_open};
                    chrome.storage.local.set(obj,function(){
                        Logger.debug('url ack saved to local storage');
                        //send open URL ack
                        sandbox.publish(attentionEvents.AttentionSessionAcknowledgeOpenURLEvent, { conversationId: newMessage.conversationId});
                    });
                } else {
                    Logger.debug('url converstation already found in storage.');
                }
            });
        };

        //Precondition: conversationId must not be non null
        this.updateMessage = function (/*guid*/ conversationId, /*bool*/ open_urls) {
            if (!conversationId) {
                throw new SystemError("Cannot call updateMessage without a conversationId");
            }
            var self = this,
                message = self.findMessageByConversationId(conversationId);
            if (message) {
                var index = self.messages.indexOf(message);
                if (index >= 0) {
                    self.messages[index].open_urls = open_urls;
                }
            }
        };

        //Precondition: conversationId must not be non null
        this.removeMessage = function (/*guid*/ conversationId) {
            if (!conversationId) {
                throw new SystemError("Cannot call removeMessage without a conversationId");
            }
            var self = this,
                message = self.findMessageByConversationId(conversationId);
            if (message) {
                var index = self.messages.indexOf(message);
                if (index >= 0) {
                    self.messages.splice(index, 1);
                    if (self.messages.length === 0) {
                        self.hideDialog();
                    }
                    else {
                        //Publish Event to Remove Message from UI if UI already exists and not the last message
                        sandbox.publish('messagesRequestRemove', message);
                    }
                }
            }
        };

        this.clear = function () {
            var self = this;
            self.messages = [];
            self.hideDialog();
        };
    };

    return Messages;
});