(function(makeScopeProxy, outerArguments, argumentsExist) {
  var hasProperty = function (obj, prop) {
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
    
    if (!propertyIsEnumerable(this.variables, 'arguments')) {
      this.variables.arguments = this.arguments;
    }
    
    if (functionName && !propertyIsEnumerable(this.variables, functionName)) {
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
    if (propertyIsEnumerable(this.variables, name)) return true;
    return false;
  }
  Scope.prototype.getValue = function getValue(name) {
    if (propertyIsEnumerable(this.variables, name)) return this.variables[name];
    return null;
  }
  Scope.prototype.setValue = function setValue(name, value, forced) {
      if (forced || propertyIsEnumerable(this.variables, name)) {
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
    return propertyIsEnumerable(this.variables, name);
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
  function TryScope(catchName) {
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
  function CatchScope(name, throwObject) {
    this.name = name;
    this.variables = Object.assign(Object.create(null),  {
      name: throwObject
    });
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
  typeof arguments !== 'undefined')
)
