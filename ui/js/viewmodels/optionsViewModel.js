define(['amd/lib/knockout'], function(ko){
    var OptionsViewModel = function() {
        this.visible= ko.observable(false);
    };

    return OptionsViewModel;
});