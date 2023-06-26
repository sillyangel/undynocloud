define(['../lib/knockout'], function(ko){
    var Status = function(config) {
        var config = config || {};

        this.text = config.text || "";
        this.order = config.order || 0;
        this.color = config.color || 'transparent';
        this.weight = config.weight || 0;
        this.showMask = ko.observable(false);
    };

    return Status;
});