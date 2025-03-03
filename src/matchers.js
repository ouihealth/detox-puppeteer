const invoke = require('detox/src/invoke');

class Matcher {
  withAncestor(matcher) {
    const _originalMatcherCall = this._call;
    if (_originalMatcherCall.method === 'selector' && matcher._call.method === 'selector') {
      this._call = {
        ..._originalMatcherCall,
        args: [`${matcher._call.args[0]}//*${_originalMatcherCall.args[0]}`],
      };
    } else {
      throw new Error('Complex withAncestor not supported');
    }
    return this;
  }
  withDescendant(matcher) {
    const _originalMatcherCall = this._call;
    if (_originalMatcherCall.method === 'selector' && matcher._call.method === 'selector') {
      this._call = {
        ..._originalMatcherCall,
        args: [`${_originalMatcherCall.args[0]}[descendant::*${matcher._call.args[0]}]`],
      };
    } else {
      throw new Error('Complex withDescendent not supported');
    }
    return this;
  }
  and(matcher) {
    const _originalMatcherCall = this._call;
    // TODO guard around complex combos
    if (matcher._call.args[0].startsWith('/')) {
      this._call = {
        target: {
          type: 'matcher',
          value: 'matcher',
        },
        method: 'selector',
        args: [`${matcher._call.args[0]}${_originalMatcherCall.args[0]}`],
      };
    } else if (_originalMatcherCall.args[0].startsWith('/')) {
      this._call = {
        target: {
          type: 'matcher',
          value: 'matcher',
        },
        method: 'selector',
        args: [`${_originalMatcherCall.args[0]}${matcher._call.args[0]}`],
      };
    } else {
      this._call = {
        target: {
          type: 'matcher',
          value: 'matcher',
        },
        method: 'selector',
        args: [`${_originalMatcherCall.args[0]}${matcher._call.args[0]}`],
      };
    }
    return this;
  }
  not() {
    throw new Error('not yet implemented');
    // const _originalMatcherCall = this._call;
    // this._call = invoke.callDirectly(GreyMatchersDetox.detoxMatcherForNot(_originalMatcherCall));
    // return this;
  }
  _avoidProblematicReactNativeElements() {
    throw new Error('not yet implemented');
    // const _originalMatcherCall = this._call;
    // this._call = invoke.callDirectly(
    //   GreyMatchersDetox.detoxMatcherAvoidingProblematicReactNativeElements(_originalMatcherCall),
    // );
    // return this;
  }
  _extendToDescendantScrollViews() {
    throw new Error('not yet implemented');
    // const _originalMatcherCall = this._call;
    // this._call = invoke.callDirectly(
    //   GreyMatchersDetox.detoxMatcherForScrollChildOfMatcher(_originalMatcherCall),
    // );
    // return this;
  }
  _extendPickerViewMatching() {
    throw new Error('not yet implemented');
    // const _originalMatcherCall = this._call;
    // this._call = invoke.callDirectly(
    //   GreyMatchersDetox.detoxMatcherForPickerViewChildOfMatcher(_originalMatcherCall),
    // );
    // return this;
  }
}

class IndexMatcher extends Matcher {
  constructor(value) {
    super();
    this._call = {
      target: {
        type: 'matcher',
        value: 'matcher',
      },
      method: 'index',
      args: [value],
    };
  }
}

class LabelMatcher extends Matcher {
  constructor(value) {
    super();
    this._call = {
      target: {
        type: 'matcher',
        value: 'matcher',
      },
      method: 'selector',
      args: [`[@aria-label='${value}']`],
    };
  }
}

class IdMatcher extends Matcher {
  constructor(value) {
    super();
    this._call = {
      target: {
        type: 'matcher',
        value: 'matcher',
      },
      method: 'selector',
      args: [`[@data-testid="${value}"]`],
    };
  }
}

class TypeMatcher extends Matcher {
  constructor(value) {
    super();
    this._call = {
      target: {
        type: 'matcher',
        value: 'matcher',
      },
      method: 'selector',
      args: [`//${value}`],
    };
  }
}

// iOS only, just a dummy matcher here
class TraitsMatcher extends Matcher {
  constructor(value) {
    super();
    this._call = {
      target: {
        type: 'matcher',
        value: 'matcher',
      },
      method: 'selector',
      args: [`*`],
    };
  }
}

class VisibleMatcher extends Matcher {
  constructor() {
    super();
    this._call = {
      target: {
        type: 'matcher',
        value: 'matcher',
      },
      method: 'option',
      args: [{ visible: true }],
    };
  }
}

class NotVisibleMatcher extends Matcher {
  constructor() {
    super();
    this._call = {
      target: {
        type: 'matcher',
        value: 'matcher',
      },
      method: 'option',
      args: [{ visible: false }],
    };
  }
}

class ExistsMatcher extends Matcher {
  constructor() {
    super();
    this._call = {
      target: {
        type: 'matcher',
        value: 'matcher',
      },
      method: 'option',
      args: [{ exists: true }],
    };
  }
}

class NotExistsMatcher extends Matcher {
  constructor() {
    super();
    this._call = {
      target: {
        type: 'matcher',
        value: 'matcher',
      },
      method: 'option',
      args: [{ exists: false }],
    };
  }
}

class TextMatcher extends Matcher {
  constructor(value) {
    super();

    if (value instanceof RegExp) {
      const stringified = value.toString(); // "/pattern/<flags>"
      const [_prefix, parts, flags] = stringified.split('/');

      this._call = {
        target: {
          type: 'matcher',
          value: 'matcher',
        },
        method: 'selector',
        args: [`[text()[matches(., '${pattern}', '${flags}')]]`],
      };
    } else {
      this._call = {
        target: {
          type: 'matcher',
          value: 'matcher',
        },
        method: 'selector',
        args: [`[contains(., '${value}') or @value='${value}']`],
      };
    }
  }
}

class ValueMatcher extends Matcher {
  constructor(value) {
    super();
    this._call = {
      target: {
        type: 'matcher',
        value: 'matcher',
      },
      method: 'selector',
      args: [`[@value="${value}"]`],
    };
  }
}

class NotValueMatcher extends Matcher {
  constructor(value) {
    super();
    this._call = {
      target: {
        type: 'matcher',
        value: 'matcher',
      },
      method: 'selector',
      args: [`[not(@value="${value}")]`],
    };
  }
}

export {
  Matcher,
  LabelMatcher,
  IdMatcher,
  TypeMatcher,
  TraitsMatcher,
  VisibleMatcher,
  NotVisibleMatcher,
  ExistsMatcher,
  NotExistsMatcher,
  TextMatcher,
  IndexMatcher,
  ValueMatcher,
  NotValueMatcher,
};
