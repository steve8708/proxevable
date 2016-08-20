const allUpdateCbs = new WeakMap()
const allPreUpdateCbs = new WeakMap()
const subscriptions = new WeakMap()

let autorunFn = null
const transactionStack = []
const autorunsAfterTransaction = new Set()

const transactionallyCall = (cb) => {
  if (transactionStack.length > 0) {
    autorunsAfterTransaction.add(cb)
  } else if (cb.minimumDelay > 0) {
    if (cb.timeoutId) {
      clearTimeout(cb.timeoutId)
    }
    cb.timeoutId = setTimeout(() => {
      cb()
      cb.timeoutId = null
    }, cb.minimumDelay)
  } else {
    cb()
  }
}

export const autorun = (fn) => {
  fn.$onDispose = []
  autorunFn = fn
  fn()
  autorunFn = null
  return () => {
    fn.$onDispose.forEach((cb) => cb())
  }
}

// TODO: source must be non number/string/symbol/null/undefined
export const observable = (source: any) => {
  const updateCbs = []
  const preUpdateCbs = []
  const thisSubscriptions = {}
  const o = new Proxy(source, {
    get(oTarget, sKey) {
      if (autorunFn) {
        if (!thisSubscriptions[sKey]) {
          thisSubscriptions[sKey] = new Set()
        }
        const set = thisSubscriptions[sKey]
        if (!set.has(autorunFn)) {
          thisSubscriptions[sKey].add(autorunFn)
          const localAutorunFn = autorunFn
          autorunFn.$onDispose.push(() => {
            thisSubscriptions[sKey].delete(localAutorunFn)
            if (thisSubscriptions[sKey].size === 0) {
              delete thisSubscriptions[sKey]
            }
          })
        }
      }

      return oTarget[sKey]
    },
    set(oTarget, sKey, vValue) {
      if (oTarget[sKey] !== vValue) {
        const change = {
          type: 'update',
          name: sKey,
          oldValue: oTarget[sKey],
          newValue: vValue
        }
        preUpdateCbs.forEach((callback) => {
          callback(change)
        })
        oTarget[sKey] = vValue

        updateCbs.forEach((callback) => {
          callback(change)
        })
        if (thisSubscriptions[sKey]) {
          thisSubscriptions[sKey].forEach((callback) => {
            autorunFn = callback
            transactionallyCall(callback)
          })
        }
        autorunFn = null
        return true
      }
      return true
    },
    deleteProperty(oTarget, sKey) {
      const change = {
        type: 'update',
        name: sKey,
        oldValue: oTarget[sKey],
        newValue: undefined
      }
      preUpdateCbs.forEach((callback) => {
        callback(change)
      })
      const deleted = delete oTarget[sKey]
      updateCbs.forEach((callback) => {
        callback(change)
      })
      if (thisSubscriptions[sKey]) {
        thisSubscriptions[sKey].forEach((callback) => {
          autorunFn = callback
          transactionallyCall(callback)
        })
      }
      return deleted
    },
    enumerate(oTarget) {
      return Object.keys(oTarget)
    }
  })
  allUpdateCbs.set(o, updateCbs)
  allPreUpdateCbs.set(o, preUpdateCbs)
  subscriptions.set(o, thisSubscriptions)
  return o
};

export const observe = (o: any, cb: Function) => {
  const updateCbs = allUpdateCbs.get(o)
  if (!updateCbs) {
    throw new Error('Object is not an observable')
  }
  updateCbs.push(cb)
  return () => {
    updateCbs.splice(updateCbs.indexOf(cb), 1)
  }
};


export const preObserve = (o: any, cb: Function) => {
  const preUpdateCbs = allPreUpdateCbs.get(o)
  if (!preUpdateCbs) {
    throw new Error('Object is not an observable')
  }
  preUpdateCbs.push(cb)
  return () => {
    preUpdateCbs.splice(preUpdateCbs.indexOf(cb), 1)
  }
};

export const autorunAsync = (fn: Function, delay: number) => {
  // FIXME: another way to do this
  (fn as any).minimumDelay = delay;
  return autorun(fn);
};


export const transaction = (fn: Function) => {
  transactionStack.push(fn)
  fn()
  if (fn === transactionStack[0]) {
    autorunsAfterTransaction.forEach((cb) => {
      cb()
    })
    transactionStack.length = 0
  }
};

