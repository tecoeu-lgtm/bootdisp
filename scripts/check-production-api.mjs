const baseUrl = process.argv[2] ?? 'https://project-hu1sk.vercel.app'

const response = await fetch(`${baseUrl}/api/health`)
const payload = await response.json()

console.log(`${response.status} ${response.statusText}`)
console.log(JSON.stringify(payload, null, 2))
