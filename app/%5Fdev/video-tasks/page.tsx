import { notFound } from 'next/navigation'

import manifest from '@/media/pilot-manifest.json'

import styles from './video-tasks.module.css'

export const dynamic = 'force-dynamic'

export default function VideoTasksPage() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>三段动态试片</h1>
          <p>开发环境媒体任务检查</p>
        </div>
        <code>npm run media:generate -- --manifest media/pilot-manifest.json --dry-run</code>
      </header>

      <section className={styles.status} aria-labelledby="status-title">
        <h2 id="status-title">当前阻塞</h2>
        <p>本地 8787 代理、实时价格、任务状态与结果下载协议尚未确认，因此不会自动提交付费任务。</p>
      </section>

      <section className={styles.taskList} aria-label="试片任务">
        {manifest.tasks.map((task, index) => (
          <article key={task.id} className={styles.task}>
            <div className={styles.taskIndex}>{String(index + 1).padStart(2, '0')}</div>
            <div>
              <h2>{task.id}</h2>
              <p>{task.kind} · {task.width}x{task.height} · H.264 · GOP {task.gop}</p>
              <dl>
                <div><dt>参考状态</dt><dd>{task.referenceStatus}</dd></div>
                <div><dt>输出</dt><dd>{task.output}</dd></div>
                <div><dt>依赖</dt><dd>{task.dependsOn.join('、') || '无'}</dd></div>
              </dl>
            </div>
          </article>
        ))}
      </section>
    </main>
  )
}
