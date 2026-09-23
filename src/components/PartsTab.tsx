import type { BrickModel } from "@/lib/model/schema";
import { groupParts } from "@/lib/model/stats";

export function PartsTab({ model }: { model: BrickModel }) {
  const groups = groupParts(model);
  const fmt = (n: number) => n.toLocaleString("en-US");
  return (
    <div className="table-wrap">
      <table className="parts-table">
        <thead>
          <tr>
            <th>Part</th>
            <th>Colour</th>
            <th className="num">Qty</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.name}>
            <tr className="group">
              <td colSpan={2}>{g.name.toUpperCase()}</td>
              <td className="num">{fmt(g.total)}</td>
            </tr>
            {g.rows.map((r) => (
              <tr key={`${r.part}|${r.color}`}>
                <td>
                  {r.name} <span className="ldraw">{r.ldraw.replace(/\.dat$/, "")}</span>
                </td>
                <td>
                  <span className="swatch" style={{ background: r.hex }} />
                  {r.colorName}
                </td>
                <td className="num">{fmt(r.qty)}</td>
              </tr>
            ))}
          </tbody>
        ))}
        <tfoot>
          <tr>
            <td colSpan={2}>Total pieces</td>
            <td className="num">{fmt(model.parts.length)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
