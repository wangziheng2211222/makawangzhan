import styles from './SiteFooter.module.css'

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div>
        <p>玛卡星球</p>
        <small>MAKAPLANET</small>
      </div>
      <nav aria-label="页脚导航">
        <a href="#town-journey">返回小镇</a>
        <a href="#choose">选择伙伴</a>
      </nav>
    </footer>
  )
}
