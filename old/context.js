(function (Layer, Scope) {
    function Context() {
        this.stack = [];
        this.global = (0, eval)('(function () {return this} ())');
        var baseLayer = new Layer(this.global, [Scope.parentScope], 0, true, true)
        this.stack.push(baseLayer)
    }
    
    Context.prototype.createLayer = function createLayer(
        scopes, returnTarget, tailable, maskResult,
        argumentNames, args, vars, functionName, func, isNew) {

        var newScope = new Scope(argumentNames, args, vars, functionName, func);
        var lastLayer = this.stack[this.stack.length - 1];
        var newLayer = new Layer(scopes.concat([newScope]), returnTarget, tailable, maskResult, isNew, Layer.TYPE.DEFAULT);
        
        if (newLayer.tailable) {
            // tail function call
            console.log('tailing call, return will jump to ' + lastLayer.returnTarget);
            newLayer.returnTarget = lastLayer.returnTarget;
            newLayer.maskResult = newLayer.maskResult || lastLayer.maskResult;
            this.stack.pop();
        }
        
        this.stack.push(newLayer);
    }
    
    Context.prototype.createLayerFromPreivous = function createLayerFromPreivous(
        newScopes, returnTarget, tailable, maskResult, isNew, type) {
        var lastLayer = this.stack[this.stack.length - 1];
        var newLayer = lastLayer.clone(newScopes, returnTarget, tailable, maskResult, isNew, type || Layer.TYPE.DEFAULT);
        
        if (newLayer.tailable) {
            // tail function call
            console.log('tailing call, return will jump to ' + lastLayer.returnTarget);
            newLayer.returnTarget = lastLayer.returnTarget;
            newLayer.maskResult = newLayer.maskResult || lastLayer.maskResult;
            this.stack.pop();
        }
        
        this.stack.push(newLayer);
    }
        
    Context.prototype.createResultLayer = function createLayer(result, returnTarget) {
        var newScope = new Scope([], [], {}, '[extern]', null);
        var newLayer = new Layer([newScope], returnTarget, false, false, false);
        newLayer.setResult(result);
        
        this.stack.push(newLayer);
    }
    
    Context.prototype.popLayer = function popLayer() {
        var layer = this.stack.pop();
        return layer;
    }
    
    Context.prototype.popUntilType = function popUntilType(type) {
        type = type || Layer.TYPE.DEFAULT;
        
        var res = [];
        var layer;
        while (layer = this.stack.pop()) {
            res.unshift(layer);
            if (layer.type === type) {
                return res;
            }
        }
        return res;
    }
    
    Context.prototype.getLayer = function getLayer() {
        var layer = this.stack[this.stack.length - 1];
        return layer;
    }
    
    return Context;
})