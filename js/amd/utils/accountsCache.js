define([
], function(
) {
    var instance = null;

    /**
     * Accounts cache constructor.
     */
    function AccountsCache() {
        this.indexAttribute = 'account_id';
        this.accounts = [];
    }

    /**
     * Getter for the shared accounts cache instance.
     * @returns {AccountsCache} The shared accounts cache instance.
     */
    AccountsCache.instance = function() {
        if (!instance) { instance = new AccountsCache(); }
        return instance;
    };

    /**
     * Helper method to delete the shared instance.
     */
    AccountsCache._destroy = function() {
        instance = null;
    };

    /**
     * Find the first index of an account with an attribute matching a value.
     * @param {string} attr The attribute name to check.
     * @param {mixed} value The value to match.
     * @returns {number|undefined} A matching index, if available.
     */
    AccountsCache.prototype.findIndex = function(attr, value) {
        var length = this.accounts.length;
        var account;

        for (var i = 0; i < length; i++) {
            account = this.accounts[i];
            // If the account matches, return the index.
            if (account && account[attr] === value) { return i; }
        }
    };

    /**
     * Find the first index for an account ID.
     * @param {number} id The account ID to find.
     */
    AccountsCache.prototype.accountIndex = function(id) {
        return this.findIndex(this.indexAttribute, id);
    };

    /**
     * Get an account for an index. This guards against bad indexes.
     * @param {number} The index to fetch.
     * @returns {object|undefined} The account, if the index is valid.
     */
    AccountsCache.prototype.getAtIndex = function(index) {
        // Guard against bad indexes.
        if (typeof index !== 'number') { return; }
        return this.accounts[index];
    };

    /**
     * Get an account for an account ID.
     * @param {number} id Find the account matching this ID.
     * @returns {object|undefined} The matching account, if available.
     */
    AccountsCache.prototype.getAccount = function(id) {
        return this.getAtIndex(this.accountIndex(id));
    };

    /**
     * Cache one or more accounts. Any accounts that were already cached will
     * be updated.
     * @param {object|object[]} account The account(s) to cache.
     */
    AccountsCache.prototype.cache = function(account) {
        // Shortcut to handle when an array of accounts is used.
        if (Array.isArray(account)) {
            account.forEach(this.cache.bind(this));
            return;
        }

        var index = this.accountIndex(account[this.indexAttribute]);
        // Update the cache for existing accounts.
        if (typeof index === 'number') {
            this.accounts[index] = account;

        // Add accounts that were not already cached.
        } else {
            this.accounts.push(account);
        }
    };

    return AccountsCache;
});