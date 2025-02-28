// @flow
import type {
  Interpolation,
  SerializedStyles,
  RegisteredCache
} from '@emotion/utils'
import hashString from '@emotion/hash'
import unitless from '@emotion/unitless'
import memoize from '@emotion/memoize'

let hyphenateRegex = /[A-Z]|^ms/g
let animationRegex = /_EMO_([^_]+?)_([^]*?)_EMO_/g

const isCustomProperty = (property: string) => property.charCodeAt(1) === 45

const processStyleName = memoize((styleName: string) =>
  isCustomProperty(styleName)
    ? styleName
    : styleName.replace(hyphenateRegex, '-$&').toLowerCase()
)

let processStyleValue = (
  key: string,
  value: string | number
): string | number => {
  if (value == null || typeof value === 'boolean') {
    return ''
  }

  switch (key) {
    case 'animation':
    case 'animationName': {
      if (typeof value === 'string') {
        return value.replace(animationRegex, (match, p1, p2) => {
          cursor = {
            name: p1,
            styles: p2,
            next: cursor
          }
          return p1
        })
      }
    }
  }

  if (
    unitless[key] !== 1 &&
    !isCustomProperty(key) &&
    typeof value === 'number' &&
    value !== 0
  ) {
    return value + 'px'
  }
  return value
}

if (process.env.NODE_ENV !== 'production') {
  let contentValuePattern = /(attr|calc|counters?|url)\(/
  let contentValues = [
    'normal',
    'none',
    'counter',
    'open-quote',
    'close-quote',
    'no-open-quote',
    'no-close-quote',
    'initial',
    'inherit',
    'unset'
  ]

  let oldProcessStyleValue = processStyleValue

  let msPattern = /^-ms-/
  let hyphenPattern = /-(.)/g

  let hyphenatedCache = {}

  processStyleValue = (key: string, value: string) => {
    if (key === 'content') {
      if (
        typeof value !== 'string' ||
        (contentValues.indexOf(value) === -1 &&
          !contentValuePattern.test(value) &&
          (value.charAt(0) !== value.charAt(value.length - 1) ||
            (value.charAt(0) !== '"' && value.charAt(0) !== "'")))
      ) {
        console.error(
          `You seem to be using a value for 'content' without quotes, try replacing it with \`content: '"${value}"'\``
        )
      }
    }

    const processed = oldProcessStyleValue(key, value)

    if (
      processed !== '' &&
      !isCustomProperty(key) &&
      key.indexOf('-') !== -1 &&
      hyphenatedCache[key] === undefined
    ) {
      hyphenatedCache[key] = true
      console.error(
        `Using kebab-case for css properties in objects is not supported. Did you mean ${key
          .replace(msPattern, 'ms-')
          .replace(hyphenPattern, (str, char) => char.toUpperCase())}?`
      )
    }

    return processed
  }
}

let shouldWarnAboutInterpolatingClassNameFromCss = true

function handleInterpolation(
  mergedProps: void | Object,
  registered: RegisteredCache | void,
  interpolation: Interpolation,
  couldBeSelectorInterpolation: boolean
): string | number {
  if (interpolation == null) {
    return ''
  }
  if (interpolation.__emotion_styles !== undefined) {
    if (
      process.env.NODE_ENV !== 'production' &&
      interpolation.toString() === 'NO_COMPONENT_SELECTOR'
    ) {
      throw new Error(
        'Component selectors can only be used in conjunction with babel-plugin-emotion.'
      )
    }
    return interpolation
  }

  switch (typeof interpolation) {
    case 'boolean': {
      return ''
    }
    case 'object': {
      if (interpolation.anim === 1) {
        cursor = {
          name: interpolation.name,
          styles: interpolation.styles,
          next: cursor
        }

        return interpolation.name
      }
      if (interpolation.styles !== undefined) {
        let next = interpolation.next
        if (next !== undefined) {
          // not the most efficient thing ever but this is a pretty rare case
          // and there will be very few iterations of this generally
          while (next !== undefined) {
            cursor = {
              name: next.name,
              styles: next.styles,
              next: cursor
            }
            next = next.next
          }
        }
        let styles = interpolation.styles
        if (
          process.env.NODE_ENV !== 'production' &&
          interpolation.map !== undefined
        ) {
          styles += interpolation.map
        }

        return styles
      }

      return createStringFromObject(mergedProps, registered, interpolation)
    }
    case 'function': {
      if (mergedProps !== undefined) {
        let previousCursor = cursor
        let result = interpolation(mergedProps)
        cursor = previousCursor

        return handleInterpolation(
          mergedProps,
          registered,
          result,
          couldBeSelectorInterpolation
        )
      } else if (process.env.NODE_ENV !== 'production') {
        console.error(
          'Functions that are interpolated in css calls will be stringified.\n' +
            'If you want to have a css call based on props, create a function that returns a css call like this\n' +
            'let dynamicStyle = (props) => css`color: ${props.color}`\n' +
            'It can be called directly with props or interpolated in a styled call like this\n' +
            "let SomeComponent = styled('div')`${dynamicStyle}`"
        )
      }
    }
    // eslint-disable-next-line no-fallthrough
    default: {
      if (registered == null) {
        return interpolation
      }
      const cached = registered[interpolation]
      if (
        process.env.NODE_ENV !== 'production' &&
        couldBeSelectorInterpolation &&
        shouldWarnAboutInterpolatingClassNameFromCss &&
        cached !== undefined
      ) {
        console.error(
          'Interpolating a className from css`` is not recommended and will cause problems with composition.\n' +
            'Interpolating a className from css`` will be completely unsupported in a future major version of Emotion'
        )
        shouldWarnAboutInterpolatingClassNameFromCss = false
      }
      return cached !== undefined && !couldBeSelectorInterpolation
        ? cached
        : interpolation
    }
  }
}

function createStringFromObject(
  mergedProps: void | Object,
  registered: RegisteredCache | void,
  obj: { [key: string]: Interpolation }
): string {
  let string = ''

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      string += handleInterpolation(mergedProps, registered, obj[i], false)
    }
  } else {
    for (let key in obj) {
      let value = obj[key]
      if (typeof value !== 'object') {
        if (registered != null && registered[value] !== undefined) {
          string += `${key}{${registered[value]}}`
        } else {
          string += `${processStyleName(key)}:${processStyleValue(key, value)};`
        }
      } else {
        if (
          key === 'NO_COMPONENT_SELECTOR' &&
          process.env.NODE_ENV !== 'production'
        ) {
          throw new Error(
            'Component selectors can only be used in conjunction with babel-plugin-emotion.'
          )
        }
        if (
          Array.isArray(value) &&
          typeof value[0] === 'string' &&
          (registered == null || registered[value[0]] === undefined)
        ) {
          for (let i = 0; i < value.length; i++) {
            string += `${processStyleName(key)}:${processStyleValue(
              key,
              value[i]
            )};`
          }
        } else {
          const interpolated = handleInterpolation(
            mergedProps,
            registered,
            value,
            false
          )
          switch (key) {
            case 'animation':
            case 'animationName': {
              string += `${processStyleName(key)}:${interpolated};`
              break
            }
            default: {
              string += `${key}{${interpolated}}`
            }
          }
        }
      }
    }
  }

  return string
}

let labelPattern = /label:\s*([^\s;\n{]+)\s*;/g

let sourceMapPattern
if (process.env.NODE_ENV !== 'production') {
  sourceMapPattern = /\/\*#\ssourceMappingURL=data:application\/json;\S+\s+\*\//
}

// this is the cursor for keyframes
// keyframes are stored on the SerializedStyles object as a linked list
let cursor

export const serializeStyles = function(
  args: Array<Interpolation>,
  registered: RegisteredCache | void,
  mergedProps: void | Object
): SerializedStyles {
  if (
    args.length === 1 &&
    typeof args[0] === 'object' &&
    args[0] !== null &&
    args[0].styles !== undefined
  ) {
    return args[0]
  }
  let stringMode = true
  let styles = ''

  cursor = undefined
  let strings = args[0]
  if (strings == null || strings.raw === undefined) {
    stringMode = false
    styles += handleInterpolation(mergedProps, registered, strings, false)
  } else {
    styles += strings[0]
  }
  // we start at 1 since we've already handled the first arg
  for (let i = 1; i < args.length; i++) {
    styles += handleInterpolation(
      mergedProps,
      registered,
      args[i],
      styles.charCodeAt(styles.length - 1) === 46
    )
    if (stringMode) {
      styles += strings[i]
    }
  }
  let sourceMap

  if (process.env.NODE_ENV !== 'production') {
    styles = styles.replace(sourceMapPattern, match => {
      sourceMap = match
      return ''
    })
  }

  // using a global regex with .exec is stateful so lastIndex has to be reset each time
  labelPattern.lastIndex = 0
  let identifierName = ''

  let match
  // https://esbench.com/bench/5b809c2cf2949800a0f61fb5
  while ((match = labelPattern.exec(styles)) !== null) {
    identifierName +=
      '-' +
      // $FlowFixMe we know it's not null
      match[1]
  }

  let name = mergedProps.prefixName
    ? mergedProps.prefixName + identifierName
    : hashString(styles) + identifierName

  if (process.env.NODE_ENV !== 'production') {
    return {
      name,
      styles,
      map: sourceMap,
      next: cursor
    }
  }
  return {
    name,
    styles,
    next: cursor
  }
}
