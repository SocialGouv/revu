import * as fs from 'fs/promises'

// This function has multiple code quality issues for testing
export async function badFunction(data: any): Promise<any> {
  // Magic number without explanation
  if (data.length > 100) {
    console.log('Data is too big!')
    return null
  }

  // Synchronous operation in async function
  const result = JSON.stringify(data)

  // Nested try-catch without proper error handling
  try {
    try {
      const file = await fs.readFile('config.json', 'utf-8')
      const config = JSON.parse(file)

      // Using var instead of const/let
      const temp = config.setting

      // No return type consistency
      if (temp) {
        return temp
      } else {
        return false
      }
    } catch (innerError) {
      throw innerError
    }
  } catch (outerError) {
    console.error('Something went wrong:', outerError)
    return undefined
  }
}

// Function with no documentation
export function mysteryFunction(a, b, c) {
  const x = a + b * c
  return x > 0 ? true : false
}
