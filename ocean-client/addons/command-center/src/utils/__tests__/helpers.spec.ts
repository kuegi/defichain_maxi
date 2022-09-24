import { isNumber } from '../helpers'

describe('Helpers', () => {
  it('should return true for isNumber 0', () => {
    expect(isNumber('0')).toBeTruthy()
  })

  it('should return true for isNumber -1', () => {
    expect(isNumber('-1')).toBeTruthy()
  })

  it('should return true for isNumber 1', () => {
    expect(isNumber('1')).toBeTruthy()
  })

  it('should return true for isNumber 42', () => {
    expect(isNumber('42')).toBeTruthy()
  })

  it('should return false for isNumber asdf', () => {
    expect(isNumber('asdf')).toBeFalsy()
  })
})
