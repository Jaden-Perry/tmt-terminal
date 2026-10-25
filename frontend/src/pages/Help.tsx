import { Panel } from '../components/Panel'
import { HELP_ROWS } from '../lib/commands'

export default function Help() {
  return (
    <div className="max-w-3xl">
      <Panel title="Command reference" png={false}>
        <table className="term">
          <tbody>
            {HELP_ROWS.map(([cmd, what]) => (
              <tr key={cmd}>
                <td className="text-amber num w-40">{cmd}</td>
                <td>{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="p-2 text-dim text-[11px] leading-relaxed">
          Press <span className="text-amber num">/</span> or <span className="text-amber num">Esc</span> anywhere to jump to the command bar. Any US ticker works, even
          outside the TMT universe. Data for those is fetched on demand. Hover any <span className="border-b border-dotted">N/A</span> to see why a value is missing.
        </div>
      </Panel>
    </div>
  )
}
