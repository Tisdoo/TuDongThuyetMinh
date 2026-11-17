# Cong cu quan ly CSDL (PostgreSQL chay trong Docker).
# Chay tu thu muc goc du an, vi du:
#   .\database\scripts\db.ps1 status
#   .\database\scripts\db.ps1 psql poi_db
#   .\database\scripts\db.ps1 backup            (sao luu ca 3 DB vao database\backups)
#   .\database\scripts\db.ps1 restore poi_db database\backups\poi_db_20261111_1200.sql
#   .\database\scripts\db.ps1 migrate           (build lai + khoi dong lai service de chay file SQL moi)
#   .\database\scripts\db.ps1 reset             (XOA SACH du lieu, tao lai tu dau)
param(
  [Parameter(Position = 0)][string]$Command = 'help',
  [Parameter(Position = 1)][string]$Database,
  [Parameter(Position = 2)][string]$File
)

$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$Dbs = @('auth_db', 'payment_db', 'poi_db')
$Services = @{ auth_db = 'auth-service'; payment_db = 'payment-service'; poi_db = 'poi-service' }

function Invoke-Compose { & docker compose --project-directory $Root @args; if ($LASTEXITCODE) { throw "docker compose loi ($LASTEXITCODE)" } }
function Assert-Db($name) { if ($Dbs -notcontains $name) { throw "Ten DB khong hop le: '$name'. Chon: $($Dbs -join ', ')" } }

switch ($Command) {
  'status' {
    foreach ($d in $Dbs) {
      Write-Host "`n== $d ==" -ForegroundColor Cyan
      Invoke-Compose exec -T postgres psql -U postgres -d $d -c "SELECT name AS migration, applied_at FROM schema_migrations ORDER BY name;" -c "\dt"
    }
  }
  'psql' {
    Assert-Db $Database
    Invoke-Compose exec postgres psql -U postgres -d $Database
  }
  'backup' {
    $dir = Join-Path $Root 'database\backups'
    New-Item -ItemType Directory -Force $dir | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd_HHmm'
    $targets = if ($Database) { Assert-Db $Database; @($Database) } else { $Dbs }
    foreach ($d in $targets) {
      $out = Join-Path $dir "${d}_$stamp.sql"
      & docker compose --project-directory $Root exec -T postgres pg_dump -U postgres -d $d --clean --if-exists |
        Out-File -Encoding utf8 $out
      if ($LASTEXITCODE) { throw "pg_dump $d loi" }
      Write-Host "Da sao luu $d -> $out"
    }
  }
  'restore' {
    Assert-Db $Database
    if (-not $File -or -not (Test-Path $File)) { throw "Can duong dan file .sql: db.ps1 restore $Database <file.sql>" }
    Get-Content -Raw -Encoding utf8 $File |
      & docker compose --project-directory $Root exec -T postgres psql -U postgres -d $Database -v ON_ERROR_STOP=1
    if ($LASTEXITCODE) { throw "restore $Database loi" }
    Write-Host "Da khoi phuc $Database tu $File"
  }
  'migrate' {
    # Moi service tu chay cac file SQL chua chay (bang schema_migrations) luc khoi dong
    $svc = if ($Database) { Assert-Db $Database; @($Services[$Database]) } else { $Services.Values }
    Invoke-Compose up -d --build @svc
    Write-Host 'Xem ket qua: docker compose logs <service> | Select-String migrate'
  }
  'reset' {
    $ok = Read-Host 'XOA TOAN BO du lieu cua ca 3 DB (khong hoan tac duoc). Go "yes" de tiep tuc'
    if ($ok -ne 'yes') { Write-Host 'Da huy.'; break }
    # Chi xoa volume pgdata (giu khoa JWT auth_keys va file poi_storage)
    Invoke-Compose down
    & docker volume rm linhung-guide_pgdata
    Invoke-Compose up -d --build
    Write-Host 'Da tao lai DB tu dau (init.sql + migrations).'
  }
  default {
    Get-Content $PSCommandPath -TotalCount 8 | Select-Object -Skip 1
  }
}
