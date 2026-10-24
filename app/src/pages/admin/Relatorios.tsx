import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, round2, type Product } from '../../lib/db';
import { money, qtyFmt, PAYMENT_LABELS, startOfDay, dec2 } from '../../lib/format';
import { downloadText } from '../../lib/backup';

const DAY = 86_400_000;
type RangeKey = 'hoje' | 'ontem' | '7' | '30' | 'mes' | 'mesPassado' | 'custom';
const RANGES: Record<RangeKey, string> = { hoje: 'Hoje', ontem: 'Ontem', '7': '7 dias', '30': '30 dias', mes: 'Este mês', mesPassado: 'Mês passado', custom: 'Escolher datas' };

type GroupKey = 'produto' | 'segmento' | 'departamento' | 'categoria' | 'subcategoria' | 'tipo' | 'marca' | 'fabricante' | 'cesta' | 'operador' | 'pagamento' | 'hora' | 'semana' | 'dia';
const GROUPS: Record<GroupKey, string> = {
  produto: 'Produto', segmento: 'Segmento', departamento: 'Departamento', categoria: 'Categoria', subcategoria: 'Subcategoria', tipo: 'Tipo', marca: 'Marca', fabricante: 'Fabricante', cesta: 'Cesta',
  operador: 'Operador', pagamento: 'Forma de pagamento', hora: 'Hora do dia', semana: 'Dia da semana', dia: 'Dia',
};
const WEEK = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const toInput = (ms: number) => new Date(ms - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const fromInput = (s: string) => new Date(s + 'T00:00:00').getTime();

function rangeOf(k: RangeKey, from: string, to: string): [number, number] {
  const today = startOfDay();
  const now = new Date();
  switch (k) {
    case 'hoje': return [today, today + DAY];
    case 'ontem': return [today - DAY, today];
    case '7': return [today - 6 * DAY, today + DAY];
    case '30': return [today - 29 * DAY, today + DAY];
    case 'mes': return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), today + DAY];
    case 'mesPassado': return [new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), new Date(now.getFullYear(), now.getMonth(), 1).getTime()];
    default: return [fromInput(from), fromInput(to) + DAY];
  }
}

interface Row { key: string; qty: number; total: number; cost: number; count: number }

function attr(p: Product | undefined, g: GroupKey, kind?: string) {
  if (kind === 'avulso') return 'Valores manuais';
  if (kind === 'naocadastrado') return 'Não cadastrados';
  const v = { segmento: p?.segment, departamento: p?.department, categoria: p?.category, subcategoria: p?.subcategory, tipo: p?.family, marca: p?.brand, fabricante: p?.manufacturer, cesta: p?.basket }[g as 'categoria'];
  return v || 'Sem informação';
}

export function Relatorios() {
  const [range, setRange] = useState<RangeKey>('30');
  const [from, setFrom] = useState(toInput(startOfDay() - 29 * DAY));
  const [to, setTo] = useState(toInput(startOfDay()));
  const [group, setGroup] = useState<GroupKey>('produto');
  const [sort, setSort] = useState<'total' | 'qty' | 'profit'>('total');
  const [start, end] = rangeOf(range, from, to);

  const data = useLiveQuery(async () => {
    const sales = await db.sales.where('createdAt').between(start, end, true, false).filter((s) => !s.deleted).toArray();
    const ids = [...new Set(sales.flatMap((s) => s.items.map((i) => i.productId)))];
    const prods = await db.products.bulkGet(ids);
    const byId = new Map(prods.filter(Boolean).map((p) => [p!.id, p!]));
    return { sales, byId };
  }, [start, end]);

  const r = useMemo(() => {
    if (!data) return null;
    const ok = data.sales.filter((s) => s.status === 'completed');
    const canceled = data.sales.length - ok.length;
    const rows = new Map<string, Row>();
    const add = (key: string, qty: number, total: number, cost: number, count = 0) => {
      const x = rows.get(key) || { key, qty: 0, total: 0, cost: 0, count: 0 };
      x.qty += qty; x.total += total; x.cost += cost; x.count += count;
      rows.set(key, x);
    };
    let revenue = 0, cost = 0, items = 0, discount = 0;
    for (const s of ok) {
      revenue += s.total;
      discount += s.discount;
      const d = new Date(s.createdAt);
      for (const i of s.items) {
        if (i.canceled) continue;
        const p = data.byId.get(i.productId);
        const c = (i.cost ?? p?.cost ?? 0) * i.qty;
        cost += c;
        items += i.unit === 'UN' ? i.qty : 1;
        let key: string | null = null;
        if (group === 'produto') key = i.kind === 'avulso' ? `${i.description} (manual)` : i.description;
        else if (['segmento', 'departamento', 'categoria', 'subcategoria', 'tipo', 'marca', 'fabricante', 'cesta'].includes(group)) key = attr(p, group, i.kind);
        if (key) add(key, i.qty, i.total, c);
      }
      if (group === 'operador') add(s.operatorName, s.items.filter((i) => !i.canceled).length, s.total, s.items.reduce((a, i) => a + (i.canceled ? 0 : (i.cost ?? 0) * i.qty), 0), 1);
      if (group === 'hora') add(String(d.getHours()).padStart(2, '0') + 'h', 1, s.total, 0, 1);
      if (group === 'semana') add(WEEK[d.getDay()], 1, s.total, 0, 1);
      if (group === 'dia') add(d.toLocaleDateString('pt-BR'), 1, s.total, 0, 1);
      if (group === 'pagamento') {
        for (const p of s.payments) add(PAYMENT_LABELS[p.method], 1, p.method === 'dinheiro' ? p.amount - s.change : p.amount, 0, 1);
      }
    }
    let list = [...rows.values()];
    if (group === 'hora') list.sort((a, b) => a.key.localeCompare(b.key));
    else if (group === 'semana') list.sort((a, b) => WEEK.indexOf(a.key) - WEEK.indexOf(b.key));
    else if (group === 'dia') list.sort((a, b) => a.key.split('/').reverse().join('').localeCompare(b.key.split('/').reverse().join('')));
    else list.sort((a, b) => (sort === 'qty' ? b.qty - a.qty : sort === 'profit' ? (b.total - b.cost) - (a.total - a.cost) : b.total - a.total));
    list = list.map((x) => ({ ...x, total: round2(x.total), cost: round2(x.cost) }));
    const profit = revenue - cost;
    return { list, count: ok.length, canceled, revenue, cost, profit, items, discount, avg: ok.length ? revenue / ok.length : 0 };
  }, [data, group, sort]);

  if (!r) return null;
  const max = Math.max(1, ...r.list.map((x) => x.total));
  const timeGroup = ['hora', 'semana', 'dia', 'pagamento', 'operador'].includes(group);
  const showCost = !timeGroup || group === 'operador';

  const exportCsv = () => {
    const head = [GROUPS[group], timeGroup ? 'Vendas' : 'Quantidade', 'Faturamento', ...(showCost ? ['Custo', 'Lucro', 'Margem %'] : []), '% do total'];
    const lines = [head.join(';')];
    for (const x of r.list) {
      const line = [x.key, timeGroup ? String(x.count) : qtyFmt(x.qty), dec2(x.total)];
      if (showCost) line.push(dec2(x.cost), dec2(x.total - x.cost), x.total ? dec2(((x.total - x.cost) / x.total) * 100) : '0');
      line.push(r.revenue ? dec2((x.total / r.revenue) * 100) : '0');
      lines.push(line.join(';'));
    }
    downloadText(`relatorio_${group}_${toInput(start)}.csv`, '﻿' + lines.join('\n'), 'text/csv');
  };

  return (
    <>
      <div className="page-head"><h1>Relatórios de vendas</h1><button className="btn sm ghost" onClick={exportCsv}>Exportar planilha (CSV)</button></div>
      <div className="row">
        {(['hoje', 'ontem', '7', '30', 'mes', 'mesPassado', 'custom'] as RangeKey[]).map((k) => <button key={k} className={'btn sm ' + (range === k ? 'secondary' : '')} onClick={() => setRange(k)}>{RANGES[k]}</button>)}
        {range === 'custom' && <>
          <input className="input" type="date" aria-label="De" style={{ width: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="input" type="date" aria-label="Até" style={{ width: 160 }} value={to} onChange={(e) => setTo(e.target.value)} />
        </>}
      </div>
      <div className="grid">
        <div className="stat"><span className="muted small">Faturamento</span><b>{money(r.revenue)}</b></div>
        <div className="stat"><span className="muted small">Vendas</span><b>{r.count}</b></div>
        <div className="stat"><span className="muted small">Ticket médio</span><b>{money(r.avg)}</b></div>
        <div className="stat"><span className="muted small">Itens vendidos</span><b>{qtyFmt(r.items)}</b></div>
        <div className="stat" style={{ background: 'var(--ok-bg)', color: 'var(--ok)' }}><span className="small">Lucro bruto</span><b>{money(r.profit)}</b><span className="small">{r.revenue ? dec2((r.profit / r.revenue) * 100) : '0'}% de margem</span></div>
        <div className="stat"><span className="muted small">Descontos · canceladas</span><b>{money(r.discount)} · {r.canceled}</b></div>
      </div>
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div className="row">
          <span className="label">Ver por:</span>
          {(Object.keys(GROUPS) as GroupKey[]).map((k) => <button key={k} className={'btn sm ' + (group === k ? 'primary' : '')} onClick={() => setGroup(k)}>{GROUPS[k]}</button>)}
        </div>
        {!timeGroup && (
          <div className="row">
            <span className="label">Ordenar:</span>
            <button className={'btn sm ' + (sort === 'total' ? 'secondary' : '')} onClick={() => setSort('total')}>Mais faturamento</button>
            <button className={'btn sm ' + (sort === 'qty' ? 'secondary' : '')} onClick={() => setSort('qty')}>Mais vendidos (qtd)</button>
            <button className={'btn sm ' + (sort === 'profit' ? 'secondary' : '')} onClick={() => setSort('profit')}>Mais lucro</button>
          </div>
        )}
        <div className="table-wrap">
          <table className="t" style={{ minWidth: 760 }}>
            <thead><tr>
              <th>#</th><th>{GROUPS[group]}</th><th className="right">{timeGroup ? 'Vendas' : 'Qtd'}</th><th className="right">Faturamento</th>
              {showCost && <><th className="right">Lucro</th><th className="right">Margem</th></>}
              <th style={{ width: '28%' }}>% do total</th>
            </tr></thead>
            <tbody>{r.list.slice(0, 300).map((x, i) => (
              <tr key={x.key}>
                <td>{i + 1}</td><td>{x.key}</td>
                <td className="right">{timeGroup ? x.count : qtyFmt(x.qty)}</td>
                <td className="right">{money(x.total)}</td>
                {showCost && <><td className="right">{money(x.total - x.cost)}</td><td className="right">{x.total ? dec2(((x.total - x.cost) / x.total) * 100) : '0'}%</td></>}
                <td>
                  <div className="row" style={{ flexWrap: 'nowrap', gap: 8 }}>
                    <div style={{ flex: 1, height: 10, background: 'var(--field)', borderRadius: 5 }}><div style={{ width: `${(x.total / max) * 100}%`, height: '100%', background: 'var(--secondary)', borderRadius: 5 }} /></div>
                    <span className="small" style={{ width: 52, textAlign: 'right' }}>{r.revenue ? dec2((x.total / r.revenue) * 100) : '0'}%</span>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
          {!r.list.length && <div className="empty">Sem vendas no período</div>}
        </div>
        {showCost && <p className="muted small" style={{ margin: 0 }}>O lucro usa o preço de custo do cadastro. Produtos sem custo aparecem com 100% de margem.</p>}
      </div>
    </>
  );
}

