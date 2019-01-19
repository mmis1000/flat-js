(function () {
    function Layer(scopes, returnTarget, tailable, maskResult, isNew, type) {
        this.scopes = scopes;
        this.returnTarget = returnTarget;
        this.resultSetted = false;
        this.returnValue = undefined;
        this.isNew = isNew;
        
        this.type = type || Layer.TYPE.DEFAULT;
        
        // try is never tailable, because everyone on the stack above may jump to try
        this.tailable = tailable && (this.type !== Layer.TYPE.TRY);
        this.maskResult = maskResult;
        
        Object.defineProperty(this, 'topScope', {
            get: function () {
                return this.scopes[this.scopes.length - 1];
            }
        })
        
    }
    
    Layer.TYPE = {
        DEFAULT: 0,
        TRY: 1,
        CATCH: 2,
        WITH: 3
    }
    
    Layer.prototype.clone = function clone(additionScope, returnTarget, tailable, maskResult, isNew, type) {
        return new Layer(this.scopes.slice(0).concat(additionScope), returnTarget, tailable, maskResult, isNew, type);
    }
    
    Layer.prototype.setResult = function setResult(res) {
        this.resultSetted = true;
        this.returnValue = res;
    }
    
    Layer.prototype.getResult = function setResult(res) {
        if (this.maskResult) {
            return undefined
        }
        
        if (this.resultSetted) {
            return this.returnValue;
        }
        
        if (this.isNew) {
            return this.getValue('this');
        }
        
        return undefined;
    }
    
    Layer.prototype.getValue = function getValue(name) {
        var i;
        for (i = this.scopes.length - 1; i >= 0; i--) {
            if (this.scopes[i].hasValue(name)) {
                return this.scopes[i].getValue(name);
            }
        }
        throw new ReferenceError(name + ' is not defined')
    }
    
    Layer.prototype.setValue = function setValue(name, value) {
        var i;
        for (i = this.scopes.length - 1; i >= 0; i--) {
            if (this.scopes[i].hasValue(name)) {
                return this.scopes[i].setValue(name, value);
            }
        }
        console.warn('setting global variable without define: ' + name);
        this.scopes[0].setValue(name, value, true);
    }
    
    Layer.prototype.pushScope = function pushScope(scope) {
        this.scopes.push(scope);
    }
    
    return Layer;
} ())