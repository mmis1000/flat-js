(function(Scope, Layer, ContextFactory) {
  const global = (0, eval)('0, function() {return this}')();
  const Reference = function(obj) {
    for (let key in obj) {
      this[key] = obj[key];
    }
  }
  const Context = ContextFactory(Layer, Scope);
  const getValue = function(reference) {
    if (!(reference instanceof Reference)) {
      return reference;
    }

    let callee = reference.callee;

    if (callee instanceof Layer) {
      return callee.getValue(reference.name);
    }

    callee = getValue(reference.callee);

    return callee[reference.name]
  }
  const setValue = function(reference, value) {
    if (!(reference instanceof Reference)) {
      return reference;
    }

    let callee = reference.callee;

    if (callee instanceof Layer) {
      return callee.setValue(reference.name, value);
    }

    callee = getValue(reference.callee);

    return callee[reference.name] = value
  }
  const getReference_ = function(context, name, callee) {
    if (!callee) {
      return new Reference({
        name: name,
        callee: context.getLayer()
      })
    }
    else {
      return new Reference({
        name: name,
        callee: callee
      })
    }
  }
  const genFunction_ = function(context, entry, name, argumentNames, variables) {
    const scopes = context.getLayer().scopes.slice(0);
    var newFunction = (0, eval)(`
      0, function (func) {
        return function ${name}() {
          var result = func.call(this, this.constructor === ${name}, arguments);
          if (this.constructor === ${name}) {
            return this;
          } else {
            return result;
          }
        }
      }
    `)(function(isNew, args) {
      return main.call(
        this, 
        entry, 
        scopes.slice(0), 
        argumentNames, 
        [].slice.call(args, 0), 
        variables, 
        name, 
        newFunction, 
        isNew
      );
      // main(entry, scopes, argumentNames, args, vars, functionName, func, isNew)
    })

    scopeMap.set(newFunction, {
      entry: entry,
      name: name,
      scopes: scopes,
      argumentNames: argumentNames,
      variables: variables
    })

    return newFunction;
  }
  const invokeExpression_ = function(context, reference, args, isNew, returnTarget, tailable, maskResult) {
    var callee = getValue(reference.callee);
    var value = getValue(reference);
    var data = scopeMap.get(value);
    var result;
    args = args.map(getValue);

    if (data) {
      if (isNew) {
        context.createLayer(
          [Scope.parentScope].concat(data.scopes), returnTarget, tailable, maskResult,
          data.argumentNames, args, Object.assign({}, data.variables, {
            "this": Object.create(value.prototype)
          }), data.name, value
        )
      } else {
        context.createLayer(
          [Scope.parentScope].concat(data.scopes), returnTarget, tailable, maskResult,
          data.argumentNames, args, Object.assign({}, data.variables, {
            "this": global
          }), data.name, value
        )
      }
      
      return data.entry;
    } else {
      if (isNew) {
        result = Object.create(value.prototype);
        value.apply(result, args)
      } else {
        if (callee instanceof Scope) {
          if (!callee.allowScopeObjectAccess()) {
            callee = global
          }
          callee = callee.variables
        }
        result = value.apply(callee, args)
      }
      
      context.createResultLayer(result)
      
      return returnTarget
    }
  }

  const scopeMap = new WeakMap();

  function main(entry, scopes, argumentNames, args, vars, functionName, func, isNew) {
    const context = new Context();
    const getReference = getReference_.bind(null, context);
    const genFunction = genFunction_.bind(null, context);
    const invokeExpression = invokeExpression_.bind(null, context);

    let scope;

    const parts = {
      0: function() {
        setValue(getReference('a'), genFunction(40, 'a', ['x'], {x: undefined}));
        setValue(getReference('b'), 1);
        setValue(getReference('c'), {y: 3});
        setValue(getReference('d'), [1, 2 ,3]);
        setValue(getReference('e'), genFunction(43, 'e', ['x'], {x: undefined}));
        next = invokeExpression(getReference('a'), [getReference('b')], false, 1, false, false);
      },
      1: function() {
        setValue(getReference('b'), context.popLayer().getResult());
        next = invokeExpression(getReference('log', getReference('console')), [getReference('b')], false, 2, false, false);
      },
      2: function() {
        context.popLayer();
        var scope = new Scope.WithScope(getValue(getReference('c')));
        context.getLayer().pushScope(scope)
        next = invokeExpression(getReference('log', getReference('console')), [getReference('y')], false, 3, false, false);
      },
      3: function() {
        context.popLayer();
        context.getLayer().popScope()
        var scope = new Scope.TryScope(5, 41, 'e');
        context.getLayer().pushScope(scope)
        next = invokeExpression(getReference('log', getReference('console')), [getReference('y')], false, 4, false, false);
      },
      4: function() {
        context.popLayer();
        context.getLayer().popScope()
        next = 5
      },
      5: function() {
        next = invokeExpression(getReference('map', getReference('d')), [getReference('e')], false, 6, false, false);
      },
      6: function() {
        context.popLayer();
        next = invokeExpression(getReference('log', getReference('console')), [getReference('y')], false, -1, false, false);
      },
      40: function() {
        context.getLayer().setResult(1 + getValue(getReference('x')));
        next = context.getLayer().returnTarget;
      },
      41: function() {
        next = invokeExpression(getReference('log', getReference('console')), ["pass"], false, 42, false, false);
      },
      42: function() {
        context.popLayer();
        context.getLayer().popScope()
        next = 5
      },
      43: function() {
        next = invokeExpression(getReference('log', getReference('console')), [getReference('x')], false, 44, false, false);
      },
      44: function() {
        context.popLayer();
        next = context.getLayer().returnTarget;
      }
    }
    
    context.createLayer(
      scopes || [Scope.parentScope], -1, false, false, argumentNames, args, vars, functionName, func, isNew
    )

    let next = entry

    while (next >= 0) {
      try {
        parts[next]();
      }
      catch (e) {
        while (context.getLayer() && !context.getLayer().hasScope(Scope.TryScope)) {
          context.popLayer();
        }

        if (!context.getLayer()) {
          // unhandeled rejection
          throw e;
        }

        scope = context.getLayer().popUntilScope(Scope.TryScope);
        context.getLayer().pushScope(new Scope.CatchScope(scope.catchName, e, scope.resume))
        next = scope.catch;
      }
    }
  }
  main(0, null, [], [], {
      a: undefined,
      b: undefined,
      c: undefined,
      d: undefined,
      'this': this,
      'console': {
        log: function(m) {
          console.log('log: ' + m)
        }
      },
      e: undefined,
      arguments: undefined
    },
    null,
    null,
    false
  )
}(
  function(makeScopeProxy, outerArguments, argumentsExist) {
    var hasProperty = function(obj, prop) {
      return prop in obj;
    }

    function Scope(argumentNames, args, vars, functionName, func) {
      // {arg1:0, null:1, wtf:2}
      var self = this;
      this.argumentNames = argumentNames;
      this.arguments = args.slice(0);
      this.variables = Object.assign(Object.create(null), vars);
      this.arguments.callee = func;
      this.functionName = functionName;
      this.function = func;

      this.argumentNames.forEach(function(name, index) {
        self.variables[name] = self.arguments[index];
        Object.defineProperty(self.arguments, index, {
          enumerable: true,
          configurable: false,
          get: function() {
            return self.variables[name];
          },
          set: function(value) {
            self.variables[name] = value;
          }
        });
      })

      if (!hasProperty(this.variables, 'arguments')) {
        this.variables.arguments = this.arguments;
      }

      if (functionName && !hasProperty(this.variables, functionName)) {
        Object.defineProperty(self.variables, functionName, {
          enumerable: true,
          configurable: false,
          writable: true,
          value: this.function
        });
      }
      // arguments.callee
    }
    // base on ecma, active object is not allowed to be exposed to the program
    Scope.prototype.allowScopeObjectAccess = function allowScopeObjectAccess() {
      return false;
    }
    Scope.prototype.getScopeObject = function getScopeObject() {
      return null;
    }
    Scope.prototype.hasValue = function hasValue(name) {
      if (hasProperty(this.variables, name)) return true;
      return false;
    }
    Scope.prototype.getValue = function getValue(name) {
      if (hasProperty(this.variables, name)) return this.variables[name];
      return null;
    }
    Scope.prototype.setValue = function setValue(name, value, forced) {
        if (forced || hasProperty(this.variables, name)) {
          this.variables[name] = value;
          return true;
        };
        return false;
      }
      // delete property on active object is not allowed
    Scope.prototype.deleteValue = function deleteValue(name) {
      return false;
    }

    // precompiled accessor for better speed
    var scopeProxies = {};

    function ParentScope() {}
    // we don't know whether the parent is AO or VO, so we use a eval eval based method
    ParentScope.prototype = Object.create(Scope.prototype);
    ParentScope.prototype.constructor = ParentScope;
    ParentScope.prototype.hasValue = function(name) {
      if (name === 'arguments') return argumentsExist;
      if (scopeProxies[name]) {
        return scopeProxies[name].hasValue();
      }
      var proxy = makeScopeProxy(name);
      if (proxy.hasValue()) {
        scopeProxies[name] = proxy;
      }
      return proxy.hasValue();
    }
    ParentScope.prototype.setValue = function(name, value) {
      if (name === 'arguments') throw new Error('unable to proxy assign to arguments, since arguments is always local in a function')
      if (scopeProxies[name]) {
        return scopeProxies[name].setValue(value);
      }
      var proxy = makeScopeProxy(name);
      if (proxy.hasValue()) {
        scopeProxies[name] = proxy;
      }
      return proxy.setValue(value);
    }
    ParentScope.prototype.getValue = function(name) {
      if (name === 'arguments') return outerArguments;
      if (scopeProxies[name]) {
        return scopeProxies[name].getValue();
      }
      var proxy = makeScopeProxy(name);
      if (proxy.hasValue()) {
        scopeProxies[name] = proxy;
      }
      return proxy.getValue();
    }
    ParentScope.prototype.deleteValue = function deleteValue(name) {
      var proxy = scopeProxies[name] || makeScopeProxy(name);
      delete scopeProxies[name];
      return proxy.deleteValue(name);
    }

    // with (variables) {} statement
    function WithScope(variables) {
      this.variables = variables;
    }
    WithScope.prototype = Object.create(Scope.prototype);
    WithScope.prototype.constructor = WithScope;
    WithScope.prototype.allowScopeObjectAccess = function allowScopeObjectAccess() {
      return true;
    }
    WithScope.prototype.getScopeObject = function getScopeObject() {
      return this.variables;
    }
    WithScope.prototype.hasValue = function(name) {
      return hasProperty(this.variables, name);
    }
    WithScope.prototype.setValue = function(name, value) {
      this.variables[name] = value;
      return true
    }
    WithScope.prototype.getValue = function(name) {
      return this.variables[name];
    }
    WithScope.prototype.deleteValue = function deleteValue(name) {
      return delete this.variables[name];
    }

    // try {/* scope */} catch (name) {} statement
    function TryScope(resumePoint, catchPoint, catchName) {
      this.resume = resumePoint;
      this.catch = catchPoint;
      this.catchName = catchName;
    }
    TryScope.prototype = Object.create(Scope.prototype);
    TryScope.prototype.constructor = TryScope;
    TryScope.prototype.allowScopeObjectAccess = function allowScopeObjectAccess() {
      return false;
    }
    TryScope.prototype.getScopeObject = function getScopeObject() {
      return null;
    }
    TryScope.prototype.hasValue = function(name) {
      return false;
    }
    TryScope.prototype.setValue = function(name, value) {
      return false;
    }
    TryScope.prototype.getValue = function(name) {
      return null;
    }
    TryScope.prototype.deleteValue = function deleteValue(name) {
      return false;
    }

    // try {} catch (name) {/* scope */} statement
    function CatchScope(name, throwObject, resumePoint) {
      this.name = name;
      this.variables = Object.assign(Object.create(null), {
        name: throwObject
      });
      this.resumePoint = resumePoint;
    }
    CatchScope.prototype = Object.create(Scope.prototype);
    CatchScope.prototype.constructor = CatchScope;
    CatchScope.prototype.allowScopeObjectAccess = function allowScopeObjectAccess() {
      return false;
    }
    CatchScope.prototype.getScopeObject = function getScopeObject() {
      return null;
    }
    CatchScope.prototype.hasValue = function(name) {
      if (name !== this.name) return false;
      return false;
    }
    CatchScope.prototype.setValue = function(name, value) {
      if (name !== this.name) return false;
      this.variables[name] = value;
      return true;
    }
    CatchScope.prototype.getValue = function(name) {
      if (name !== this.name) return null;
      return this.variables[name];
    }
    CatchScope.prototype.deleteValue = function deleteValue(name) {
      return false;
    }

    Scope.ParentScope = ParentScope;
    Scope.parentScope = new ParentScope();
    Scope.WithScope = WithScope;
    Scope.TryScope = TryScope;
    Scope.CatchScope = CatchScope;
    return Scope;
  }(
    function() {
      try {
        return {
          hasValue: eval(`(function(){
                try {
                    ${ arguments[0].replace(/[\.\(\[\{\s\\\/*]/g, '') }
                } catch (e) {
                    return false
                }; 
                return true
            })`),
          getValue: eval(`(function(){
                try {
                    return ${ arguments[0].replace(/[\.\(\[\{\s\\\/*]/g, '') }
                } catch (e) {
                    return null
                }; 
            })`),
          setValue: eval(`(function(){
                try {
                    ${ arguments[0].replace(/[\.\(\[\{\s\\*\/]/g, '') } = arguments[0]
                    return true
                } catch (e) {
                    return false
                };
            })`),
          deleteValue: eval(`(function(){
                try {
                    return delete ${ arguments[0].replace(/[\.\(\[\{\s\\*\/]/g, '') }
                } catch (e) {
                    return false
                };
            })`)
        }
      }
      catch (e) {
        return {
          hasValue: () => false,
          setValue: () => false,
          getValue: () => null,
          deleteValue: () => null
        }
      }
    }.bind(this),
    typeof arguments !== 'undefined' ? arguments : null,
    typeof arguments !== 'undefined'),
  function() {
    function Layer(scopes, returnTarget, tailable, maskResult, isNew) {
      this.scopes = scopes;
      this.returnTarget = returnTarget;
      this.resultSetted = false;
      this.returnValue = undefined;
      this.isNew = isNew;

      this.tailable = tailable;
      this.maskResult = maskResult;
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
      throw new ReferenceError('undefined variable: ' + name)
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
    Layer.prototype.popScope = function popScope(type) {
      return this.scopes.pop();
    }
    Layer.prototype.hasScope = function popUntilScope(type) {
      for (var i = this.scopes.length - 1; i >= 0; i--) {
        if (this.scopes[i] instanceof type) {
          return true;
        }
      }
      return false;
    }
    Layer.prototype.popUntilScope = function popUntilScope(type) {
      if (!this.hasScope(type)) {
        throw new Error('scope not found')
      }
      var scope;
      while (scope = this.scopes.pop()) {
        if (scope instanceof type) {
          return scope;
        }
      }
    }
    return Layer;
  }(),
  function(Layer, Scope) {
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
      var newLayer = new Layer(scopes.concat([newScope]), returnTarget, tailable, maskResult, isNew);

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
    Context.prototype.popLayer = function createLayer() {
      var layer = this.stack.pop();
      return layer;
    }
    Context.prototype.getLayer = function getLayer() {
      var layer = this.stack[this.stack.length - 1];
      return layer;
    }
    return Context;
  }
))