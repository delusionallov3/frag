import { useApp } from '../store'

export default function Toast(): JSX.Element | null {
  const toast = useApp((s) => s.toast)
  if (!toast) return null
  return (
    <div className="toast" key={toast.id}>
      <span>{toast.text}</span>
      {toast.action && (
        <button
          className="link-btn"
          onClick={() => {
            toast.action?.run()
            useApp.setState({ toast: null })
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}
