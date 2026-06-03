# oshi-calendar

X/Nitter RSS から推しグループの告知を拾い、ライブ本体・チケット発売・締切などを分けて表示する GitHub Pages 向けカレンダーです。

## できること

- グループごとの個別カレンダー URL
  - `/oshi-calendar/stainy/`
- 全グループ一覧トップ
  - `/oshi-calendar/`
- ライブとチケ発を別イベントとして表示
- カレンダー内に START / チケ発時刻を表示
- 日付クリックでイベント一覧を絞り込み
- イベントカードクリックで詳細モーダル表示
- 将来の複数グループ追加に備えた `config/groups.json`

## ディレクトリ

```text
.
├── .github/workflows/fetch_events.yml
├── config/groups.json
├── data/stainy/events.json
├── docs/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   ├── config/groups.json
│   ├── data/stainy/events.json
│   └── stainy/index.html
└── scripts/fetch_events.py
```

`docs/` を GitHub Pages の公開ルートにします。GitHub Pages は `docs/` の外を配信できないため、公開用データは `docs/data/<group>/events.json` に置いています。`data/` は編集・生成元の控えです。

## グループ追加

1. `config/groups.json` と `docs/config/groups.json` にグループを追加
2. `data/<group>/events.json` と `docs/data/<group>/events.json` を追加
3. `docs/stainy/index.html` をコピーして `docs/<group>/index.html` を作り、`data-group-id` を変更

## 自動取得

`.github/workflows/fetch_events.yml` は 1 日 1 回 `scripts/fetch_events.py` を動かします。

本格運用では GitHub Secrets に以下を設定してください。

- `ANTHROPIC_API_KEY`: Claude API キー

API キーがない場合は、STAiNY の典型的な告知フォーマット向けの簡易パーサーで更新します。Claude API を設定すると抽出精度を上げられます。

## 公開

GitHub Pages の公開元は `main` ブランチの `/docs` にしてください。

Repository Settings → Pages → Build and deployment:

- Source: `Deploy from a branch`
- Branch: `main`
- Folder: `/docs`

この方式なら、静的サイト用の deploy workflow は不要です。GitHub Actions は RSS 取得と `events.json` 更新だけに使います。

公開 URL:

- https://jazznuma.github.io/oshi-calendar/
- https://jazznuma.github.io/oshi-calendar/stainy/
