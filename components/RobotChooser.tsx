'use client'

import Image from 'next/image'
import { type CSSProperties, forwardRef } from 'react'

import { trackEvent } from '@/lib/analytics'
import type { RobotProfile } from '@/types/robot'

import styles from './RobotChooser.module.css'

type RobotChooserProps = {
  robots: RobotProfile[]
}

const availabilityLabels = {
  available: '现货',
  preorder: '预售',
  'coming-soon': '即将推出',
} as const

export const RobotChooser = forwardRef<HTMLHeadingElement, RobotChooserProps>(
  function RobotChooser({ robots }, ref) {
    return (
      <section id="choose" className={styles.chooser} aria-labelledby="chooser-title">
        <div className={styles.headingRow}>
          <h2 id="chooser-title" ref={ref} tabIndex={-1}>
            选择你的玛卡伙伴
          </h2>
          <p>四位居民，同等等待被选择。</p>
        </div>

        <div className={styles.robotGrid}>
          {robots.map((robot) => {
            return (
              <article
                key={robot.id}
                className={styles.robotCard}
                style={{ '--robot-accent': robot.accent } as CSSProperties}
              >
                <div className={styles.imageFrame}>
                  <Image
                    src={robot.productImage}
                    alt={`${robot.name}机器人`}
                    fill
                    sizes="(max-width: 700px) 88vw, (max-width: 1100px) 44vw, 22vw"
                    style={{ objectFit: 'contain' }}
                  />
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.nameRow}>
                    <div>
                      <h3>{robot.name}</h3>
                      <p className={styles.englishName}>{robot.englishName}</p>
                    </div>
                    {robot.availability ? (
                      <p className={styles.availability}>{availabilityLabels[robot.availability]}</p>
                    ) : null}
                  </div>
                  <p className={styles.archetype}>{robot.archetype}</p>
                  <dl className={styles.details}>
                    <div><dt>故事能力</dt><dd>{robot.storyAbility}</dd></div>
                    <div><dt>口头禅</dt><dd>“{robot.catchphrase}”</dd></div>
                    {robot.productCapability ? (
                      <div><dt>产品功能</dt><dd>{robot.productCapability}</dd></div>
                    ) : null}
                    {robot.audience ? <div><dt>适合</dt><dd>{robot.audience}</dd></div> : null}
                  </dl>
                  <details className={styles.storyDetails}>
                    <summary>认识 TA 的故事</summary>
                    <p>{robot.originStory}</p>
                    <p>喜欢：{robot.likes.join('、')} · 害怕：{robot.fears.join('、')}</p>
                    {robot.relationships?.map((relationship) => (
                      <p key={relationship}>{relationship}</p>
                    ))}
                  </details>
                  {robot.ctaHref && robot.ctaLabel ? (
                    <a
                      className={styles.detailLink}
                      href={robot.ctaHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`查看${robot.name}详情`}
                      onClick={() => {
                        trackEvent('business_cta_click', {
                          robot_id: robot.id,
                          source: 'chooser',
                          destination: robot.ctaHref,
                        })
                      }}
                    >
                      {robot.ctaLabel}
                    </a>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    )
  },
)
