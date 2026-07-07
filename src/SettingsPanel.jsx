import { motion } from 'framer-motion'

// Settings modal opened from the top-right profile avatar. For now it holds the
// account section + Sign out; room to grow later.
export default function SettingsPanel({ user, onClose, onSignOut }) {
  const meta = user.user_metadata || {}
  const avatarUrl = meta.avatar_url || meta.picture
  const name = meta.full_name || meta.name || 'Signed in'

  return (
    <motion.div
      className="settings-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      onClick={onClose}
    >
      <motion.div
        className="settings-panel"
        initial={{ scale: 0.94, opacity: 0, y: 16 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 8 }}
        transition={{ type: 'spring', stiffness: 260, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="settings-close" onClick={onClose} title="Close">×</button>
        <div className="settings-title">Settings</div>

        <div className="settings-account">
          {avatarUrl
            ? <img className="settings-avatar" src={avatarUrl} alt="" referrerPolicy="no-referrer" draggable={false} />
            : <div className="settings-avatar settings-avatar-fallback">{(user.email || '?')[0].toUpperCase()}</div>}
          <div className="settings-account-text">
            <div className="settings-name">{name}</div>
            <div className="settings-email">{user.email}</div>
          </div>
        </div>

        <button className="settings-signout" onClick={onSignOut}>Sign out</button>
      </motion.div>
    </motion.div>
  )
}
