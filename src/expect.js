const invoke = require('../invoke');
const matchers = require('./matchers');
const Matcher = matchers.Matcher;
const LabelMatcher = matchers.LabelMatcher;
const IndexMatcher = matchers.IndexMatcher;
const IdMatcher = matchers.IdMatcher;
const TypeMatcher = matchers.TypeMatcher;
const TraitsMatcher = matchers.TraitsMatcher;
const VisibleMatcher = matchers.VisibleMatcher;
const NotVisibleMatcher = matchers.NotVisibleMatcher;
const ExistsMatcher = matchers.ExistsMatcher;
const NotExistsMatcher = matchers.NotExistsMatcher;
const NotValueMatcher = matchers.NotValueMatcher;
const TextMatcher = matchers.TextMatcher;
const ValueMatcher = matchers.ValueMatcher;

function callThunk(element) {
  return typeof element._call === 'function' ? element._call() : element._call;
}

class Action {}

class TapAction extends Action {
  constructor() {
    super();
    this._call = {
      target: {
        type: 'action',
        value: 'action'
      },
      method: 'tap',
      args: []
    };
  }
}

class TapAtPointAction extends Action {
  constructor(value) {
    super();
    this._call = {
      target: {
        type: 'action',
        value: 'action'
      },
      method: 'tapAtPoint',
      args: [value] // NB value is currently unused
    };
  }
}

class LongPressAction extends Action {
  constructor(duration) {
    super();
    if (typeof duration !== 'number') {
      this._call = {
        target: {
          type: 'action',
          value: 'action'
        },
        method: 'longPress',
        args: [700] // https://github.com/google/EarlGrey/blob/91c27bb8a15e723df974f620f7f576a30a6a7484/EarlGrey/Common/GREYConstants.m#L27
      };
    } else {
      this._call = {
        target: {
          type: 'action',
          value: 'action'
        },
        method: 'longPress',
        args: [duration]
      };
    }
  }
}

class MultiTapAction extends Action {
  constructor(value) {
    super();
    this._call = {
      target: {
        type: 'action',
        value: 'action'
      },
      method: 'multiTap',
      args: [value]
    };
  }
}

class PinchAction extends Action {
  constructor(direction, speed, angle) {
    super();
    if (typeof direction !== 'string') throw new Error(`PinchAction ctor 1st argument must be a string, got ${typeof direction}`);
    if (typeof speed !== 'string') throw new Error(`PinchAction ctor 2nd argument must be a string, got ${typeof speed}`);
    if (typeof angle !== 'number') throw new Error(`PinchAction ctor 3nd argument must be a number, got ${typeof angle}`);
    if (speed === 'fast') {
      this._call = invoke.callDirectly(GreyActions.actionForPinchFastInDirectionWithAngle(direction, angle));
    } else if (speed === 'slow') {
      this._call = invoke.callDirectly(GreyActions.actionForPinchSlowInDirectionWithAngle(direction, angle));
    } else {
      throw new Error(`PinchAction speed must be a 'fast'/'slow', got ${speed}`);
    }
  }
}

class TypeTextAction extends Action {
  constructor(value) {
    super();
    this._call = {
      target: {
        type: 'action',
        value: 'action'
      },
      method: 'typeText',
      args: [value]
    };
  }
}

class KeyboardPressAction extends Action {
  constructor(value) {
    super();
    this._call = {
      target: {
        type: 'action',
        value: 'action'
      },
      method: 'keyboardPress',
      args: [value]
    };
  }
}

class ReplaceTextAction extends Action {
  constructor(value) {
    super();
    this._call = {
      target: {
        type: 'action',
        value: 'action'
      },
      method: 'replaceText',
      args: [value]
    };
  }
}

class ClearTextAction extends Action {
  constructor() {
    super();
    this._call = {
      target: {
        type: 'action',
        value: 'action'
      },
      method: 'clearText',
      args: []
    };
  }
}

class ScrollAmountAction extends Action {
  constructor(direction, amount, startScrollX = NaN, startScrollY = NaN) {
    super();
    this._call = {
      target: {
        type: 'action',
        value: 'action'
      },
      method: 'scroll',
      args: [direction, amount]
    };
  }
}

class ScrollEdgeAction extends Action {
  constructor(edge) {
    super();

    this._call = {
      target: {
        type: 'action',
        value: 'action'
      },
      method: 'scrollTo',
      args: [edge]
    };
  }
}

class SwipeAction extends Action {
  constructor(direction, speed, percentage) {
    super();
    if (typeof direction !== 'string') throw new Error(`SwipeAction ctor 1st argument must be a string, got ${typeof direction}`);
    if (typeof speed !== 'string') throw new Error(`SwipeAction ctor 2nd argument must be a string, got ${typeof speed}`);

    this._call = {
      target: {
        type: 'action',
        value: 'action'
      },
      method: 'swipe',
      args: [direction, speed, percentage]
    };
  }
}

class ScrollColumnToValue extends Action {
  constructor(column, value) {
    super();
    this._call = invoke.callDirectly(GreyActions.actionForSetPickerColumnToValue(column, value));
  }
}

class SetDatePickerDate extends Action {
  constructor(dateString, dateFormat) {
    super();
    this._call = invoke.callDirectly(GreyActionsDetox.detoxSetDatePickerDateWithFormat(dateString, dateFormat));
  }
}

class Interaction {
  constructor(invocationManager) {
    this._invocationManager = invocationManager;
  }

  async execute() {
    //if (!this._call) throw new Error(`Interaction.execute cannot find a valid _call, got ${typeof this._call}`);
    await this._invocationManager.execute(this._call);
  }
}

class ActionInteraction extends Interaction {
  constructor(invocationManager, element, action) {
    super(invocationManager);

    // this._call = GreyInteraction.performAction(invoke.callDirectly(callThunk(element)), callThunk(action));
    this._call = {
      target: {
        type: 'this',
        value: 'this'
      },
      method: 'performAction',
      args: [invoke.callDirectly(callThunk(element)), callThunk(action)]
    };
  }
}

class MatcherAssertionInteraction extends Interaction {
  constructor(invocationManager, element, matcher) {
    super(invocationManager);

    this._call = {
      target: 'this',
      method: 'assertWithMatcher',
      args: [invoke.callDirectly(callThunk(element)), callThunk(matcher)]
    };
  }
}

class WaitForInteraction extends Interaction {
  constructor(invocationManager, element, matcher) {
    super(invocationManager);
    //if (!(element instanceof Element)) throw new Error(`WaitForInteraction ctor 1st argument must be a valid Element, got ${typeof element}`);
    //if (!(matcher instanceof Matcher)) throw new Error(`WaitForInteraction ctor 2nd argument must be a valid Matcher, got ${typeof matcher}`);
    this._element = element;
    this._originalMatcher = matcher;
    // we need to override the original matcher for the element and add matcher to it as well
    this._element._selectElementWithMatcher(this._element._originalMatcher, this._originalMatcher);
  }
  async withTimeout(timeout) {
    if (typeof timeout !== 'number') throw new Error(`WaitForInteraction withTimeout argument must be a number, got ${typeof timeout}`);
    if (timeout < 0) throw new Error('timeout must be larger than 0');

    let _conditionCall;

    const call = callThunk(this._element);
    call.args.push({
      target: {
        type: 'matcher',
        value: 'matcher'
      },
      method: 'option',
      args: [{ timeout }]
    });
    this._call = call;
    // this._call = GreyCondition.waitWithTimeout(invoke.callDirectly(_conditionCall), timeout / 1000);
    await this.execute();
  }
  whileElement(searchMatcher) {
    return new WaitForActionInteraction(this._invocationManager, this._element, this._originalMatcher, searchMatcher);
  }
}

class WaitForActionInteraction extends Interaction {
  constructor(invocationManager, element, matcher, searchMatcher) {
    super(invocationManager);
    //if (!(element instanceof Element)) throw new Error(`WaitForActionInteraction ctor 1st argument must be a valid Element, got ${typeof element}`);
    //if (!(matcher instanceof Matcher)) throw new Error(`WaitForActionInteraction ctor 2nd argument must be a valid Matcher, got ${typeof matcher}`);
    if (!(searchMatcher instanceof Matcher))
      throw new Error(`WaitForActionInteraction ctor 3rd argument must be a valid Matcher, got ${typeof searchMatcher}`);
    this._element = element;
    this._originalMatcher = matcher;
    this._searchMatcher = searchMatcher;
  }

  async _execute(searchAction) {
    const _interactionCall = GreyInteraction.usingSearchActionOnElementWithMatcher(
      invoke.callDirectly(callThunk(this._element)),
      callThunk(searchAction),
      callThunk(this._searchMatcher)
    );

    this._call = GreyInteraction.assertWithMatcher(invoke.callDirectly(_interactionCall), callThunk(this._originalMatcher));
    await this.execute();
  }
  async scroll(amount, direction = 'down', startScrollX, startScrollY) {
    // override the user's element selection with an extended matcher that looks for UIScrollView children
    this._searchMatcher = this._searchMatcher._extendToDescendantScrollViews();
    await this._execute(new ScrollAmountAction(direction, amount, startScrollX, startScrollY));
  }
}

class Element {
  constructor(invocationManager, matcher) {
    this._invocationManager = invocationManager;
    this._originalMatcher = matcher;
    this._selectElementWithMatcher(this._originalMatcher);
  }
  _selectElementWithMatcher(...matchers) {
    // if (!(matcher instanceof Matcher))
    //   throw new Error(`Element _selectElementWithMatcher argument must be a valid Matcher, got ${typeof matcher}`);
    matchers = Array.isArray(matchers) ? matchers : [matchers];
    this._call = invoke.call(
      {
        type: 'this',
        value: 'this'
      },
      'selectElementWithMatcher',
      ...matchers.map((m) => m._call)
    );
    // if (this._atIndex !== undefined) {
    //   this.atIndex(this._atIndex);
    // }
  }
  atIndex(index) {
    if (typeof index !== 'number') throw new Error(`Element atIndex argument must be a number, got ${typeof index}`);
    const _originalCall = this._call;
    this._atIndex = index;
    this._selectElementWithMatcher(this._originalMatcher, new IndexMatcher(index));
    return this;
  }
  async tap() {
    return await new ActionInteraction(this._invocationManager, this, new TapAction()).execute();
  }
  async tapAtPoint(value) {
    return await new ActionInteraction(this._invocationManager, this, new TapAtPointAction(value)).execute();
  }
  async longPress(duration) {
    return await new ActionInteraction(this._invocationManager, this, new LongPressAction(duration)).execute();
  }
  async multiTap(value) {
    return await new ActionInteraction(this._invocationManager, this, new MultiTapAction(value)).execute();
  }
  async tapBackspaceKey() {
    return await new ActionInteraction(this._invocationManager, this, new KeyboardPressAction('Backspace')).execute();
  }
  async tapReturnKey() {
    return await new ActionInteraction(this._invocationManager, this, new TypeTextAction(String.fromCharCode(13))).execute();
  }
  async typeText(value) {
    return await new ActionInteraction(this._invocationManager, this, new TypeTextAction(value)).execute();
  }
  async replaceText(value) {
    return await new ActionInteraction(this._invocationManager, this, new ReplaceTextAction(value)).execute();
  }
  async clearText() {
    return await new ActionInteraction(this._invocationManager, this, new ClearTextAction()).execute();
  }
  async pinchWithAngle(direction, speed = 'slow', angle = 0) {
    return await new ActionInteraction(this._invocationManager, this, new PinchAction(direction, speed, angle)).execute();
  }
  async scroll(amount, direction = 'down', startScrollX, startScrollY) {
    // override the user's element selection with an extended matcher that looks for UIScrollView children
    // this._selectElementWithMatcher(this._originalMatcher._extendToDescendantScrollViews());
    return await new ActionInteraction(
      this._invocationManager,
      this,
      new ScrollAmountAction(direction, amount, startScrollX, startScrollY)
    ).execute();
  }
  async scrollTo(edge) {
    // override the user's element selection with an extended matcher that looks for UIScrollView children
    // this._selectElementWithMatcher(this._originalMatcher._extendToDescendantScrollViews());
    return await new ActionInteraction(this._invocationManager, this, new ScrollEdgeAction(edge)).execute();
  }
  async swipe(direction, speed = 'fast', percentage = 0) {
    return await new ActionInteraction(this._invocationManager, this, new SwipeAction(direction, speed, percentage)).execute();
  }
  async setColumnToValue(column, value) {
    // override the user's element selection with an extended matcher that supports RN's date picker
    this._selectElementWithMatcher(this._originalMatcher._extendPickerViewMatching());
    return await new ActionInteraction(this._invocationManager, this, new ScrollColumnToValue(column, value)).execute();
  }
  async setDatePickerDate(dateString, dateFormat) {
    return await new ActionInteraction(this._invocationManager, this, new SetDatePickerDate(dateString, dateFormat)).execute();
  }
}

class Expect {
  constructor(invocationManager) {
    this._invocationManager = invocationManager;
  }
}

class ExpectElement extends Expect {
  constructor(invocationManager, element) {
    super(invocationManager);
    this._element = element;
  }
  async toBeVisible() {
    return await new MatcherAssertionInteraction(this._invocationManager, this._element, new VisibleMatcher()).execute();
  }
  async toBeNotVisible() {
    return await new MatcherAssertionInteraction(this._invocationManager, this._element, new NotVisibleMatcher()).execute();
  }
  async toExist() {
    return await new MatcherAssertionInteraction(this._invocationManager, this._element, new ExistsMatcher()).execute();
  }
  async toNotExist() {
    return await new MatcherAssertionInteraction(this._invocationManager, this._element, new NotExistsMatcher()).execute();
  }
  async toHaveText(value) {
    return await new MatcherAssertionInteraction(this._invocationManager, this._element, new TextMatcher(value)).execute();
  }
  async toHaveLabel(value) {
    return await new MatcherAssertionInteraction(this._invocationManager, this._element, new LabelMatcher(value)).execute();
  }
  async toHaveId(value) {
    return await new MatcherAssertionInteraction(this._invocationManager, this._element, new IdMatcher(value)).execute();
  }
  async toHaveValue(value) {
    return await new MatcherAssertionInteraction(this._invocationManager, this._element, new ValueMatcher(value)).execute();
  }
}

class WaitFor {
  constructor(invocationManager) {
    this._invocationManager = invocationManager;
  }
}

class WaitForElement extends WaitFor {
  constructor(invocationManager, element) {
    super(invocationManager);
    //if ((!element instanceof Element)) throw new Error(`WaitForElement ctor argument must be a valid Element, got ${typeof element}`);
    this._element = element;
  }
  toBeVisible() {
    return new WaitForInteraction(this._invocationManager, this._element, new VisibleMatcher());
  }
  toBeNotVisible() {
    return new WaitForInteraction(this._invocationManager, this._element, new NotVisibleMatcher());
  }
  toExist() {
    return new WaitForInteraction(this._invocationManager, this._element, new ExistsMatcher());
  }
  toNotExist() {
    return new WaitForInteraction(this._invocationManager, this._element, new NotExistsMatcher());
  }
  toHaveText(text) {
    return new WaitForInteraction(this._invocationManager, this._element, new TextMatcher(text));
  }
  toHaveValue(value) {
    return new WaitForInteraction(this._invocationManager, this._element, new ValueMatcher(value));
  }
  toNotHaveValue(value) {
    return new WaitForInteraction(this._invocationManager, this._element, new NotValueMatcher(value));
  }
}

class WebExpect {
  constructor(invocationManager) {
    this._invocationManager = invocationManager;

    this.by = {
      accessibilityLabel: (value) => new LabelMatcher(value),
      label: (value) => new LabelMatcher(value),
      id: (value) => new IdMatcher(value),
      type: (value) => new TypeMatcher(value),
      traits: (value) => new TraitsMatcher(value),
      value: (value) => new ValueMatcher(value),
      text: (value) => new TextMatcher(value)
    };

    this.element = this.element.bind(this);
    this.expect = this.expect.bind(this);
    this.waitFor = this.waitFor.bind(this);
  }

  expect(element) {
    if (element instanceof Element) return new ExpectElement(this._invocationManager, element);
    throw new Error(`expect() argument is invalid, got ${typeof element}`);
  }

  element(matcher) {
    return new Element(this._invocationManager, matcher);
  }

  waitFor(element) {
    if (element instanceof Element) return new WaitForElement(this._invocationManager, element);
    throw new Error(`waitFor() argument is invalid, got ${typeof element}`);
  }
}

module.exports = WebExpect;
