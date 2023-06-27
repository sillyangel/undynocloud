define([
    'amd/cabra/helper/attention', 'amd/cabra/helper/messages', 'amd/logger/logger',
    'amd/urlAckPurger', 'amd/utils/accountsCache', 'underscore'
], function(
    Attention, Messages, Logger,
    UrlAckPurger, AccountsCache, _
) {
    var instance = null;
    var constants = {
        payloads: {
            kAttentionLockedRequest: '35b75155-44f9-4a83-aa7d-80d6fd371bcf',
            kAttentionUnlockedRequest: '5927bfeb-0fdb-49ea-ad1a-cd57194c301b',
            kAttentionUnlockedACK: '416ea7f8-4cd0-4f0e-82e4-aeb1b5057b8f'
        },
        lockedRequests: {
            kAttentionRequestLocked: 'locked',
            kAttentionRequestUnlocked: 'unlocked'
        }
    };

    /**
     * Attention manager constructor.
     */
    function AttentionManager() {
        Logger.info('AttentionManager: instance constructed');
        this.attention = new Attention();
        this.messages = new Messages();
        this.course = null;
    }

    /**
     * Getter for the shared attention manager instance.
     * @return {AttentionManager} The attention manager singleton.
     */
    AttentionManager.instance = function() {
        if (!instance) { instance = new AttentionManager(); }
        return instance;
    };

    /**
     * Restore from a captured state.
     * @param {State} state A QSR state to restore.
     */
    AttentionManager.prototype.restoreState = function(state) {
        var attentionState = state.getNamed('attention');
        Logger.info('AttentionManager: restoring state', attentionState);
        this.applyState(attentionState);
    };

    /**
     * Set the course for the attention manager.
     * @param {object} course The course to use.
     */
    AttentionManager.prototype.setCourse = function(course) {
        // Guard against non-changes.
        if (this.course === course) { return; }

        // Cache any new teachers when courses change.
        var teachers = (course || {}).teachers;
        if (teachers && teachers.length) {
            AccountsCache.instance().cache(teachers);
        }
        
        this.course = course;
    };

    /**
     * Get the display information for a teacher.
     * @param {object} teacher Get display information for this teacher.
     * @returns {string} The information to display.
     */
    AttentionManager.prototype.teacherInfo = function(teacher) {
        // Guard against not having any teacher for information.
        if (!teacher) { return ''; }

        var info = [];
        if (teacher.first_name) { info.push(teacher.first_name); }
        if (teacher.last_name) { info.push(teacher.last_name); }

        return info.join(' ');
    };

    /**
     * Get the teacher ID for a frame.
     */
    AttentionManager.prototype.accountIdForFrame = function(frame) {
        // Guard against the frame being falsy.
        if (!frame) { return; }

        // Handle frames explicitly from the broadcaster.
        if (frame.from_option === 'broadcaster' && frame.from) {
            var id = parseInt(frame.from, 10);
            if (id && isFinite(id)) {
                return parseInt(frame.from, 10);
            }
        }

        // If available fallback to any account ID on the frame.
        return frame.account_id || undefined;
    };

    /**
     * Get the teacher for a frame.
     * @param {object} frame The frame that contains the teacher ID.
     */
    AttentionManager.prototype.teacherForFrame = function(frame) {
        var accountId = this.accountIdForFrame(frame);
        return AccountsCache.instance().getAccount(accountId);
    };

    /**
     * Convenience method to clear state.
     * @param {boolean} quiet If logging should be skipped.
     */
    AttentionManager.prototype.clear = function(quiet) {
        if (quiet !== true) {
            Logger.info('AttentionManager: Clearing attention.');
        }
        this.clearLocking();
        this.messages.clear();
    };

    /**
     * Apply attention from state or a realtime frame.
     * @param {object} state The state to apply.
     */
    AttentionManager.prototype.applyState = function(state) {
        state = state || {};

        // Apply from a single frame.
        if (state.payload_id) {
            Logger.info('AttentionManager: applying realtime frame');
            this.applyFrame(state);

        // Apply from a full state object.
        } else if (state.payload && Object.keys(state.payload).length) {
            UrlAckPurger.purgeOldAckEntries();

            if (state.payload.locked_message) {
                Logger.info('AttentionManager: applying locked message');
                this.applyFrame(state.payload.locked_message);
            }
            if (state.payload.messages && state.payload.messages.length) {
                Logger.info('AttentionManager: applying messages');
                state.payload.messages.forEach(this.applyFrame.bind(this));
            } else {
                Logger.info('AttentionManager: No messages in state, clearing.');
                this.messages.clear();
            }

        // Unknown or bad state object.
        } else {
            UrlAckPurger.purgeOldAckEntries();

            Logger.warn('AttentionManager: Unknown attention state, assuming the desired behavior is to clear attention', state);
            this.clear(true);
        }
    };

    /**
     * Apply a state frame.
     * @param {object} frame The state frame to apply.
     */
    AttentionManager.prototype.applyFrame = function(frame) {
        var payloadId = frame && frame.payload_id;

        if (payloadId === constants.payloads.kAttentionLockedRequest) {
            Logger.info('AttentionManager: locking request');
            this.applyLockingMessage(frame);
        } else if (payloadId === constants.payloads.kAttentionUnlockedRequest) {
            Logger.info('AttentionManager: attention request');
            this.applyNonLockingMessage(frame);
        } else {
            Logger.warn('AttentionManager: Unknown payload ID, ignoring frame');
        }
    };

    /**
     * Apply a frame confirmed to be for locking.
     * @param {object} frame The locking frame to apply.
     */
    AttentionManager.prototype.applyLockingMessage = function(frame) {
        var lockFlags = this.attention.lockFlags;
        var flag = lockFlags.kAttentionClear;
        var message;

        if (frame.payload && Object.keys(frame.payload).length) {
            message = frame.payload.message;
            var lock = frame.payload.lock;
            if (lock === constants.lockedRequests.kAttentionRequestLocked) {
                flag = lockFlags.kAttentionScreen + lockFlags.kAttentionKeyboard + lockFlags.kAttentionMouse;
            }
        } else {
            Logger.debug('AttentionManager: Payload ommited or empty, assuming the desired behavior is to clear attention', frame);
        }

        this.applyLocking(flag, message, frame);
    };

    /**
     * Apply a frame confirmed to be for a non-locking message.
     * @param {object} frame The non-locking frame to apply.
     */
    AttentionManager.prototype.applyNonLockingMessage = function(frame) {
        if (!frame.payload || !frame.payload.message) { return; }

        var teacher = this.teacherForFrame(frame);
        var payload = frame.payload;
        this.messages.addMessage(frame.conversation_id,
            payload.message, payload.open_urls,
            this.teacherInfo(teacher));
    };

    /**
     * Helper to clear attention.
     */
    AttentionManager.prototype.clearLocking = function() {
        this.applyLocking(this.attention.lockFlags.kAttentionClear);
    };

    /**
     * Apply or clear a locking attention message.
     * @param {mixed} flag The locking flag to apply.
     * @param {string} [message] An optional message for locking.
     */
    AttentionManager.prototype.applyLocking = function(flag, message, frame) {
        // Shortcut if no flag was defined.
        if (flag === undefined || flag === null) { return; }

        Logger.info('AttentionManager: Applying message and flag', message, flag);
        var details;

        if (this.course) {
            var courseInfo = '';
            if (this.course.period) { courseInfo += this.course.period; }
            if (this.course.name) {
                if (courseInfo) { courseInfo += ' - '; }
                courseInfo += this.course.name;
            }
            var teacher = this.teacherForFrame(frame);
            details = 'Your device has been locked by\r\n' +
                this.teacherInfo(teacher) + '\r\n' + courseInfo;
        }

        this.attention.setBlocking(flag, message, details);
    };

    /**
     * Remove one message.
     */
    AttentionManager.prototype.removeMessage = function(conversationId) {
        this.messages.removeMessage(conversationId);
    };

    /**
     * Update one message.
     */
    AttentionManager.prototype.updateMessage = function(conversationId, openUrls) {
        this.messages.updateMessage(conversationId, openUrls);
    };

    return AttentionManager;
});