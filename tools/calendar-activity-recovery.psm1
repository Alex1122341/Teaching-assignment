Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
function Get-PrivateCalendarRecoveryPath([string]$Path){
 $full=[IO.Path]::GetFullPath($Path)
 $repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd([IO.Path]::DirectorySeparatorChar)
 if($full.Equals($repo,[StringComparison]::OrdinalIgnoreCase) -or $full.StartsWith($repo+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)){
  throw 'Recovery artifact must remain outside the repository and Hosting artifacts.'
 }
 $parent=$full
 while($parent){
  if(Test-Path -LiteralPath $parent){
   $item=Get-Item -LiteralPath $parent -Force
   if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Recovery path must not contain links or reparse points.'}
   if($item.PSIsContainer -and ((Test-Path -LiteralPath (Join-Path $parent '.git')) -or $item.Name -in @('.deploy-static','.deploy-azure-api'))){
    throw 'Recovery artifact must remain outside the repository and Hosting artifacts.'
   }
  }
  $parent=[IO.Path]::GetDirectoryName($parent)
 }
 return $full
}
function Get-CalendarRecoveryHash([byte[]]$Bytes){
 $hash=[Security.Cryptography.SHA256]::Create()
 try{return ([BitConverter]::ToString($hash.ComputeHash($Bytes))).Replace('-','')}finally{$hash.Dispose()}
}
function Write-PrivateCalendarRecoveryFile([string]$Path,[byte[]]$Bytes){
 $full=Get-PrivateCalendarRecoveryPath $Path
 if($Bytes.Length -eq 0 -or $Bytes.Length -gt 16777216){throw 'A bounded recovery artifact is required.'}
 $stream=[IO.File]::Open($full,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
 try{
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $acl=[Security.AccessControl.FileSecurity]::new();$acl.SetOwner($identity);$acl.SetAccessRuleProtection($true,$false)
  foreach($sid in @($identity,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))){
   $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow))
  }
  if($PSVersionTable.PSEdition -eq 'Desktop'){[IO.File]::SetAccessControl($full,$acl)}
  else{[IO.FileSystemAclExtensions]::SetAccessControl([IO.FileInfo]::new($full),$acl)}
  $stream.Write($Bytes,0,$Bytes.Length)
 }finally{$stream.Dispose()}
}
function Invoke-TrustedCalendarRecovery([string]$Procedure,[string]$ActorFirebaseUid,[guid]$ReceiptId,[string]$ExpectedSha256=''){
 if($Procedure -notin @('ExportCalendarActivityRecovery','RecoverCalendarActivityImport')){throw 'Unsupported recovery procedure.'}
 if([string]::IsNullOrWhiteSpace($ActorFirebaseUid) -or $ActorFirebaseUid.Length -gt 128){throw 'An authenticated administrator actor is required.'}
 if([string]::IsNullOrWhiteSpace($env:PAWS_SQL_RECOVERY_CONNECTION_STRING)){throw 'Trusted recovery connection string is required.'}
 $builder=[Data.SqlClient.SqlConnectionStringBuilder]::new($env:PAWS_SQL_RECOVERY_CONNECTION_STRING)
 if(-not $builder.IntegratedSecurity -or -not $builder.Encrypt -or $builder.TrustServerCertificate -or $builder.InitialCatalog -ne 'VetMed-Ops'){
  throw 'Recovery requires encrypted Windows integrated authentication to VetMed-Ops with certificate validation.'
 }
 $connection=[Data.SqlClient.SqlConnection]::new($builder.ConnectionString)
 try{
  $command=$connection.CreateCommand();$command.CommandType=[Data.CommandType]::StoredProcedure;$command.CommandText='paws_api.'+$Procedure;$command.CommandTimeout=120
  [void]$command.Parameters.Add('@ActorFirebaseUid',[Data.SqlDbType]::NVarChar,128);$command.Parameters['@ActorFirebaseUid'].Value=$ActorFirebaseUid
  [void]$command.Parameters.Add('@ReceiptId',[Data.SqlDbType]::UniqueIdentifier);$command.Parameters['@ReceiptId'].Value=$ReceiptId
  if($Procedure -eq 'RecoverCalendarActivityImport'){
   [void]$command.Parameters.Add('@ExpectedRecoverySha256',[Data.SqlDbType]::Char,64);$command.Parameters['@ExpectedRecoverySha256'].Value=$ExpectedSha256
   [void]$command.Parameters.Add('@Confirm',[Data.SqlDbType]::Bit);$command.Parameters['@Confirm'].Value=$true
  }
  $table=[Data.DataTable]::new();$adapter=[Data.SqlClient.SqlDataAdapter]::new($command)
  try{$connection.Open();[void]$adapter.Fill($table);return ,$table}finally{$adapter.Dispose();$command.Dispose()}
 }finally{$connection.Dispose()}
}
Export-ModuleMember -Function Get-PrivateCalendarRecoveryPath,Get-CalendarRecoveryHash,Write-PrivateCalendarRecoveryFile,Invoke-TrustedCalendarRecovery
