param([ValidateSet('DryRun','Apply')][string]$Mode='DryRun')
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
if ([System.Net.Dns]::GetHostName() -ne 'ITAPPVETOPSDB01') { throw 'Wrong device' }
$connection=[System.Data.SqlClient.SqlConnection]::new('Server=tcp:ITAPPVETOPSDB01.uc.ucalgary.ca,1433;Initial Catalog=VetMed-Ops;Integrated Security=SSPI;Encrypt=True;TrustServerCertificate=False;Connect Timeout=20;Application Name=PAWS-Rule-Encoding-Repair;')
$connection.Open()
try {
  $command=$connection.CreateCommand()
  $command.CommandText="SELECT r.* FROM paws.DoeRuleSeed r JOIN paws.DoePolicyVersion p ON p.PolicyVersionId=r.PolicyVersionId WHERE p.AcademicYear=N'2026-27' AND p.Active=1 FOR JSON PATH, INCLUDE_NULL_VALUES;"
  $reader=$command.ExecuteReader()
  $json=''
  while($reader.Read()) { $json += $reader.GetString(0) }
  $reader.Dispose()
  $rows=ConvertFrom-Json -InputObject $json
  $bad=([string][char]0x00e2)+([char]0x20ac)+([char]0x201c)
  $good=[string][char]0x2013
  $matches=@($rows|Where-Object { $_.RuleLabel.Contains($bad) })
  $rows|ForEach-Object { Write-Output ("{0} | {1} | {2}" -f $_.Category,$_.RuleLabel,$_.AcademicYearOrStage) }
  Write-Output "Affected rows: $($matches.Count)"
  if($Mode -eq 'DryRun') { return }
  if($matches.Count -ne 3) { throw 'Expected exactly three corrupted guideline rules; stop.' }
  $codes=@('course_coordination_3_5','course_coordination_6_9','course_coordination_10_14')
  foreach($row in $matches) { if(($row.RawJson|ConvertFrom-Json).ruleCode -notin $codes) { throw 'Unexpected rule identity' } }
  $backup=Join-Path $PSScriptRoot ('before-'+[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')+'.json')
  [System.IO.File]::WriteAllText($backup,$json,[System.Text.UTF8Encoding]::new($false))
  $transaction=$connection.BeginTransaction()
  try {
    $command.Transaction=$transaction
    $command.CommandText=@'
UPDATE paws.DoeRuleSeed
 SET RuleLabel=REPLACE(RuleLabel,@bad,@good),
     AcademicYearOrStage=REPLACE(AcademicYearOrStage,@bad,@good),
     RawJson=REPLACE(RawJson,@bad,@good)
 WHERE DoeRuleSeedId=@id AND RuleLabel=@beforeLabel AND AcademicYearOrStage=@beforeStage AND RawJson=@beforeJson;
'@
    [void]$command.Parameters.Add('@bad',[System.Data.SqlDbType]::NVarChar,3)
    [void]$command.Parameters.Add('@good',[System.Data.SqlDbType]::NVarChar,1)
    [void]$command.Parameters.Add('@id',[System.Data.SqlDbType]::UniqueIdentifier)
    [void]$command.Parameters.Add('@beforeLabel',[System.Data.SqlDbType]::NVarChar,256)
    [void]$command.Parameters.Add('@beforeStage',[System.Data.SqlDbType]::NVarChar,128)
    [void]$command.Parameters.Add('@beforeJson',[System.Data.SqlDbType]::NVarChar,-1)
    $command.Parameters['@bad'].Value=$bad
    $command.Parameters['@good'].Value=$good
    foreach($row in $matches) {
      $command.Parameters['@id'].Value=[guid]$row.DoeRuleSeedId
      $command.Parameters['@beforeLabel'].Value=$row.RuleLabel
      $command.Parameters['@beforeStage'].Value=$row.AcademicYearOrStage
      $command.Parameters['@beforeJson'].Value=$row.RawJson
      if($command.ExecuteNonQuery() -ne 1) { throw 'Row changed concurrently; rollback.' }
    }
    $transaction.Commit()
    Write-Output "COMMITTED: 3 text-only repairs. Backup: $backup"
  } catch { $transaction.Rollback(); throw }
} finally { $connection.Dispose() }
