define(function () {

    var INSTANCE;
  
    function MyInfo(info) {
      if (!(this instanceof MyInfo)) {
        return new MyInfo(info);
      }
      this.info = info;
    }
  
  
    return {
      init: function () {
        if (!INSTANCE) {
          INSTANCE = MyInfo.apply(null, arguments);        
        }
        return INSTANCE;
      },
      getInstance: function () {
        if (!INSTANCE) {
          return this.init.apply(this, arguments);
        }
        return INSTANCE;
      }
    };
  
  });