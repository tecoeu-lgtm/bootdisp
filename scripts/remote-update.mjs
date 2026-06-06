import { spawnSync } from 'node:child_process'

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log('JusPrevConecta: validando codigo...')
run('npm', ['run', 'build'])

console.log('JusPrevConecta: publicando atualizacao remota na Vercel...')
run('npx', ['vercel', '--prod', '--yes'])

console.log('JusPrevConecta: atualizacao remota concluida.')
