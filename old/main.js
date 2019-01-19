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

    const codes = __CODE_PARTS__;
    const stack = []

    function transformToPart(codes) {
      var mapped = codes.map((code, index)=>({ code, index}))

      var parts = {}

      var index = 0

      while (index < mapped.length) {
        switch (mapped[index].code) {
          case "getScope":
            parts[mapped[index].index] = function () {
              stack.push(context.getLayer());
            }
            index++;
          case "putUndefined":
            parts[mapped[index].index] = function () {
              stack.push(undefined);
            }
            index++;
          case "putNumber":
            parts[mapped[index].index] = function (number) {
              stack.push(number);
            }.bind(mapped[index + 1].code)
            index += 2;
          case "initScope":
            parts[mapped[index].index] = function () {
              var argNameLength = stack.pop()
              var argNames = []
              while (argNameLength-- > 0) {
                argNames.unshift(stack.pop())
              }
              var argLength = stack.pop()
              var args = []
              while (argLength-- > 0) {
                args.unshift(stack.pop())
              }
              var fn = stack.pop()
              var self = this;
              //Nope:
              context.createLayer(
                scopes || [Scope.parentScope], -1, false, false, argumentNames, args, vars, functionName, func, isNew
              )
            }
            index += 1;
          case "jump":
            parts[mapped[index].index] = function () {
              var nextBranch = stack.pop()
              next = nextBranch
            }
            index += 1;
          case "putString":
            parts[mapped[index].index] = function (str) {
              stack.push(str);
            }.bind(mapped[index + 1].code)
            index += 2;
          case "newVar":
            parts[mapped[index].index] = function () {
              context.getLayer().topScope[stack.pop()] = undefined;
            }
            index += 1;
          case "dupeVal":
            parts[mapped[index].index] = function (offset) {
              stack.push(stack.length - 1 - offset)
            }.bind(mapped[index + 1].code)
            index += 2;
          case "getVal":
            parts[mapped[index].index] = function () {
              var name = stack.pop()
              var self = stack.pop();
              if (self instanceof Layer) {
                return self.getValue(name)
              } else {
                return self[name]
              }
            }
            index += 1;
          case "leaveScope":
            parts[mapped[index].index] = function () {
              // TODO:
            }
            index += 1;
          case "pop":
            parts[mapped[index].index] = function () {
              stack.pop()
            }
            index += 1;
          case "call":
            parts[mapped[index].index] = function () {
              // TODO:
            }
            index += 1;
        }
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
  main(0, null, [], [], __GLOBAL_VARS__,
    null,
    null,
    false
  )
})