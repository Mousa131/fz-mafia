<?php
error_reporting(0);ini_set('display_errors',0);
require __DIR__.'/config.php';
header('Content-Type: application/json; charset=utf-8');header('Cache-Control: no-store');
function out($a){echo json_encode($a,JSON_UNESCAPED_UNICODE);exit;}
function fail($m){out(['err'=>1,'m'=>$m]);}
try{$db=new PDO('mysql:host='.DB_HOST.';dbname='.DB_NAME.';charset=utf8mb4',DB_USER,DB_PASS,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);}catch(Throwable $e){fail('تعذر الاتصال بقاعدة البيانات');}
function q($s,$p=[]){global $db;$st=$db->prepare($s);$st->execute($p);return $st;}
function row($s,$p=[]){return q($s,$p)->fetch();}
function rows($s,$p=[]){return q($s,$p)->fetchAll();}
function lg($t,$u='',$r='',$i=''){q('INSERT INTO fs_log(ts,type,uid,room,info) VALUES(NOW(),?,?,?,?)',[$t,$u,$r,mb_substr($i,0,250)]);}
function install(){global $db;$e='ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';
$db->exec("CREATE TABLE IF NOT EXISTS fs_users(id INT AUTO_INCREMENT PRIMARY KEY,uid CHAR(24) UNIQUE,name VARCHAR(40) DEFAULT '',settings TEXT,games INT DEFAULT 0,wins INT DEFAULT 0,created DATETIME,seen DATETIME)$e");
$db->exec("CREATE TABLE IF NOT EXISTS fs_rooms(code CHAR(5) PRIMARY KEY,host_pid INT DEFAULT 0,ed TINYINT DEFAULT 1,status VARCHAR(8) DEFAULT 'lobby',phase VARCHAR(8) DEFAULT 'lobby',round INT DEFAULT 0,phase_end INT DEFAULT 0,winner VARCHAR(8) DEFAULT '',cfg TEXT,data TEXT,created DATETIME,upd DATETIME)$e");
$db->exec("CREATE TABLE IF NOT EXISTS fs_players(id INT AUTO_INCREMENT PRIMARY KEY,room CHAR(5),uid CHAR(24),name VARCHAR(20),av TEXT,role VARCHAR(8) DEFAULT '',alive TINYINT DEFAULT 1,vote INT NULL,act INT NULL,info TEXT,INDEX(room),INDEX(uid))$e");
$db->exec("CREATE TABLE IF NOT EXISTS fs_chat(id INT AUTO_INCREMENT PRIMARY KEY,room CHAR(5),pid INT,name VARCHAR(20),msg VARCHAR(300),ch CHAR(1) DEFAULT 'a',ts INT,INDEX(room))$e");
$db->exec("CREATE TABLE IF NOT EXISTS fs_games(id INT AUTO_INCREMENT PRIMARY KEY,mode VARCHAR(8),room CHAR(5) DEFAULT '',players INT,winner VARCHAR(8),rounds INT,uid CHAR(24) DEFAULT '',ts DATETIME)$e");
$db->exec("CREATE TABLE IF NOT EXISTS fs_plays(id INT AUTO_INCREMENT PRIMARY KEY,uid CHAR(24),mode VARCHAR(8),role VARCHAR(8) DEFAULT '',won TINYINT NULL,rounds INT DEFAULT 0,ts DATETIME,INDEX(uid))$e");
$db->exec("CREATE TABLE IF NOT EXISTS fs_log(id INT AUTO_INCREMENT PRIMARY KEY,ts DATETIME,type VARCHAR(20),uid CHAR(24),room CHAR(5),info VARCHAR(255))$e");}
function finish($r,$P,$w){
 q('INSERT INTO fs_games(mode,room,players,winner,rounds,ts) VALUES(\'online\',?,?,?,?,NOW())',[$r['code'],count($P),$w,$r['round']]);
 foreach($P as $p){$won=(($p['role']=='mafia')==($w=='mafia'))?1:0;q('UPDATE fs_users SET games=games+1,wins=wins+? WHERE uid=?',[$won,$p['uid']]);q('INSERT INTO fs_plays(uid,mode,role,won,rounds,ts) VALUES(?,\'online\',?,?,?,NOW())',[$p['uid'],$p['role'],$won,$r['round']]);}
 lg('end','',$r['code'],$w);}
function tick($code){global $db;$db->beginTransaction();
 $r=row('SELECT * FROM fs_rooms WHERE code=? FOR UPDATE',[$code]);
 if(!$r||$r['status']!='play'){$db->commit();return;}
 $P=rows('SELECT * FROM fs_players WHERE room=?',[$code]);$al=array_filter($P,fn($p)=>$p['alive']);$night=$r['phase']=='night';
 if($night){$need=array_filter($al,fn($p)=>in_array($p['role'],['mafia','doctor','elder']));$done=!array_filter($need,fn($p)=>$p['act']===null);}
 else $done=!array_filter($al,fn($p)=>$p['vote']===null);
 if(!$done&&time()<$r['phase_end']){$db->commit();return;}
 $cfg=json_decode($r['cfg'],true);$d=json_decode($r['data']?:'{}',true);$ev=null;$nm=fn($id)=>array_values(array_filter($P,fn($p)=>$p['id']==$id))[0];
 if($night){
  $v=[];foreach($al as $p)if($p['role']=='mafia'&&$p['act']!==null)$v[$p['act']]=($v[$p['act']]??0)+1;
  $tg=null;if($v){$c=array_keys($v,max($v));$tg=$c[array_rand($c)];}
  if($tg===null){$c=array_values(array_filter($al,fn($p)=>$p['role']!='mafia'));if($c)$tg=$c[array_rand($c)]['id'];}
  $pr=null;foreach($al as $p)if($p['role']=='doctor')$pr=$p['act'];
  if($tg!==null&&$tg!=$pr){q('UPDATE fs_players SET alive=0 WHERE id=?',[$tg]);$ev=['t'=>'n','k'=>'kill','pid'=>(int)$tg,'name'=>$nm($tg)['name']];}else $ev=['t'=>'n','k'=>'saved'];
 }else{
  $v=[];foreach($al as $p)if($p['vote']!==null)$v[$p['vote']]=($v[$p['vote']]??0)+1;
  $c=$v?array_keys($v,max($v)):[];
  if(count($c)==1){q('UPDATE fs_players SET alive=0 WHERE id=?',[$c[0]]);$o=$nm($c[0]);$ev=['t'=>'d','k'=>'out','pid'=>(int)$o['id'],'name'=>$o['name'],'role'=>$o['role']];}else $ev=['t'=>'d','k'=>'tie'];
 }
 $P=rows('SELECT * FROM fs_players WHERE room=?',[$code]);$a=array_filter($P,fn($p)=>$p['alive']);$m=count(array_filter($a,fn($p)=>$p['role']=='mafia'));
 $w=!$m?'citizens':($m>=count($a)-$m?'mafia':'');
 $d['seq']=($d['seq']??0)+1;$d['ev']=$ev;
 if($w){q('UPDATE fs_rooms SET status=\'end\',phase=\'end\',winner=?,data=?,upd=NOW() WHERE code=?',[$w,json_encode($d,JSON_UNESCAPED_UNICODE),$code]);finish($r,$P,$w);}
 else{q('UPDATE fs_players SET act=NULL,vote=NULL WHERE room=?',[$code]);
  $np=$night?'day':'night';$sec=$night?$cfg['vote']:$cfg['night'];
  q('UPDATE fs_rooms SET phase=?,round=?,phase_end=?,data=?,upd=NOW() WHERE code=?',[$np,$r['round']+($night?0:1),time()+$sec,json_encode($d,JSON_UNESCAPED_UNICODE),$code]);}
 $db->commit();}
function state($code,$uid,$after){
 tick($code);$r=row('SELECT * FROM fs_rooms WHERE code=?',[$code]);if(!$r)fail('الغرفة غير موجودة');
 $me=row('SELECT * FROM fs_players WHERE room=? AND uid=?',[$code,$uid]);if(!$me)fail('الغرفة غير موجودة');
 $P=rows('SELECT * FROM fs_players WHERE room=? ORDER BY id',[$code]);$d=json_decode($r['data']?:'{}',true);$end=$r['status']=='end';$day=$r['phase']=='day';
 $vc=[];foreach($P as $p)if($p['vote']!==null&&$p['alive'])$vc[$p['vote']]=($vc[$p['vote']]??0)+1;
 $pl=array_map(fn($p)=>['id'=>(int)$p['id'],'name'=>$p['name'],'alive'=>(bool)$p['alive'],'av'=>json_decode($p['av']?:'null'),'host'=>$p['id']==$r['host_pid'],'v'=>$day?($vc[$p['id']]??0):0]+($end?['role'=>$p['role']]:[]),$P);
 $mates=[];if($me['role']=='mafia')foreach($P as $p)if($p['role']=='mafia'&&$p['id']!=$me['id'])$mates[]=(int)$p['id'];
 $chat=rows("SELECT id,name,msg,ch FROM fs_chat WHERE room=? AND id>? AND (ch='a' OR ?=1) ORDER BY id LIMIT 60",[$code,(int)$after,$me['role']=='mafia'?1:0]);
 out(['ok'=>1,'host'=>$me['id']==$r['host_pid'],
  'room'=>['code'=>$code,'ed'=>(int)$r['ed'],'status'=>$r['status'],'phase'=>$r['phase'],'round'=>(int)$r['round'],'left'=>max(0,$r['phase_end']-time()),'winner'=>$r['winner'],'cfg'=>json_decode($r['cfg']),'seq'=>$d['seq']??0,'ev'=>$d['ev']??null],
  'me'=>['id'=>(int)$me['id'],'role'=>$me['role'],'alive'=>(bool)$me['alive'],'act'=>$me['act']===null?null:(int)$me['act'],'vote'=>$me['vote']===null?null:(int)$me['vote'],'mates'=>$mates,'chk'=>json_decode($me['info']?:'{}')],
  'players'=>$pl,'chat'=>$chat]);}
$in=json_decode(file_get_contents('php://input'),true)?:[];$a=$in['a']??'';$uid=$in['uid']??'';$code=strtoupper(preg_replace('/[^A-Za-z0-9]/','',$in['code']??''));
try{
if($a=='hello'){install();
 if(!preg_match('/^[a-f0-9]{24}$/',$uid))$uid=bin2hex(random_bytes(12));
 $u=row('SELECT * FROM fs_users WHERE uid=?',[$uid]);
 if(!$u){q('INSERT INTO fs_users(uid,settings,created,seen) VALUES(?,\'\',NOW(),NOW())',[$uid]);$u=row('SELECT * FROM fs_users WHERE uid=?',[$uid]);}else q('UPDATE fs_users SET seen=NOW() WHERE uid=?',[$uid]);
 lg('visit',$uid);out(['ok'=>1,'uid'=>$uid,'name'=>$u['name'],'settings'=>json_decode($u['settings']?:'null'),'games'=>(int)$u['games'],'wins'=>(int)$u['wins']]);}
if(!preg_match('/^[a-f0-9]{24}$/',$uid))fail('uid');
$name=mb_substr(trim($in['name']??''),0,12);
switch($a){
case 'save': q('UPDATE fs_users SET settings=?,name=IF(?=\'\',name,?),seen=NOW() WHERE uid=?',[json_encode($in['settings']??new stdClass),$name,$name,$uid]);out(['ok'=>1]);
case 'game_end':
 $w=in_array($in['winner']??'',['mafia','citizens'])?$in['winner']:'citizens';$md=in_array($in['mode']??'',['solo','local'])?$in['mode']:'solo';
 q('INSERT INTO fs_games(mode,players,winner,rounds,uid,ts) VALUES(?,?,?,?,?,NOW())',[$md,(int)$in['n'],$w,(int)$in['rounds'],$uid]);
 q('UPDATE fs_users SET games=games+1,wins=wins+? WHERE uid=?',[!empty($in['won'])?1:0,$uid]);$ro=in_array($in['role']??'',['mafia','doctor','elder','citizen'])?$in['role']:'';q('INSERT INTO fs_plays(uid,mode,role,won,rounds,ts) VALUES(?,?,?,?,?,NOW())',[$uid,$md,$ro,$md=='local'?null:(!empty($in['won'])?1:0),(int)$in['rounds']]);
 lg('end_'.$md,$uid,'',$w);out(['ok'=>1]);
case 'stats':
 $t=row('SELECT SUM(won=1) w,SUM(won=0) l,COUNT(*) g FROM fs_plays WHERE uid=?',[$uid]);$m=[];$rr=[];
 foreach(rows('SELECT mode,COUNT(*) g,SUM(won=1) w FROM fs_plays WHERE uid=? GROUP BY mode',[$uid]) as $x)$m[$x['mode']]=['g'=>(int)$x['g'],'w'=>(int)$x['w']];
 foreach(rows('SELECT role,COUNT(*) g,SUM(won=1) w FROM fs_plays WHERE uid=? AND role<>\'\' GROUP BY role',[$uid]) as $x)$rr[$x['role']]=['g'=>(int)$x['g'],'w'=>(int)$x['w']];
 out(['ok'=>1,'g'=>(int)$t['g'],'w'=>(int)$t['w'],'l'=>(int)$t['l'],'m'=>(object)$m,'r'=>(object)$rr]);
case 'room_create':
 $name=$name?:'Player';
 q('DELETE FROM fs_players WHERE room IN(SELECT code FROM fs_rooms WHERE upd<NOW()-INTERVAL 1 DAY)');q('DELETE FROM fs_chat WHERE room IN(SELECT code FROM fs_rooms WHERE upd<NOW()-INTERVAL 1 DAY)');q('DELETE FROM fs_rooms WHERE upd<NOW()-INTERVAL 1 DAY');
 do{$c=substr(str_shuffle('ABCDEFGHJKLMNPQRSTUVWXYZ23456789'),0,5);}while(row('SELECT 1 FROM fs_rooms WHERE code=?',[$c]));
 $cf=['max'=>8,'night'=>max(10,min(60,(int)($in['night']??25))),'vote'=>max(15,min(120,(int)($in['vote']??45)))];
 q('INSERT INTO fs_rooms(code,ed,cfg,data,created,upd) VALUES(?,1,?,\'{}\',NOW(),NOW())',[$c,json_encode($cf)]);
 q('INSERT INTO fs_players(room,uid,name,av) VALUES(?,?,?,?)',[$c,$uid,$name,json_encode($in['av']??null)]);
 q('UPDATE fs_rooms SET host_pid=? WHERE code=?',[$db->lastInsertId(),$c]);q('UPDATE fs_users SET name=? WHERE uid=?',[$name,$uid]);lg('room_new',$uid,$c);out(['ok'=>1,'code'=>$c]);
case 'room_join':
 $r=row('SELECT * FROM fs_rooms WHERE code=?',[$code]);if(!$r)fail('الغرفة غير موجودة');
 if(row('SELECT 1 FROM fs_players WHERE room=? AND uid=?',[$code,$uid]))out(['ok'=>1,'code'=>$code]);
 if($r['status']!='lobby')fail('بدأت اللعبة بالفعل');
 if(row('SELECT COUNT(*) n FROM fs_players WHERE room=?',[$code])['n']>=json_decode($r['cfg'],true)['max'])fail('الغرفة ممتلئة');
 $name=$name?:'Player';q('INSERT INTO fs_players(room,uid,name,av) VALUES(?,?,?,?)',[$code,$uid,$name,json_encode($in['av']??null)]);q('UPDATE fs_users SET name=? WHERE uid=?',[$name,$uid]);lg('join',$uid,$code,$name);out(['ok'=>1,'code'=>$code]);
case 'room_state': state($code,$uid,$in['after']??0);
case 'room_cfg': case 'room_again': case 'room_start': case 'act': case 'chat': case 'leave':
 $r=row('SELECT * FROM fs_rooms WHERE code=?',[$code]);$me=row('SELECT * FROM fs_players WHERE room=? AND uid=?',[$code,$uid]);if(!$r||!$me)fail('الغرفة غير موجودة');
 $host=$me['id']==$r['host_pid'];$cf=json_decode($r['cfg'],true);$n=row('SELECT COUNT(*) n FROM fs_players WHERE room=?',[$code])['n'];
 if($a=='room_cfg'){if(!$host||$r['status']!='lobby')fail('x');
  if(isset($in['ed']))q('UPDATE fs_rooms SET ed=? WHERE code=?',[max(1,min(3,(int)$in['ed'])),$code]);
  if(isset($in['cfg'])){$c=$in['cfg'];$cf=['max'=>max(5,$n,min(12,(int)$c['max'])),'night'=>max(10,min(60,(int)$c['night'])),'vote'=>max(15,min(120,(int)$c['vote']))];q('UPDATE fs_rooms SET cfg=? WHERE code=?',[json_encode($cf),$code]);}
  q('UPDATE fs_rooms SET upd=NOW() WHERE code=?',[$code]);out(['ok'=>1]);}
 if($a=='room_again'){if(!$host||$r['status']!='end')fail('x');
  q('UPDATE fs_players SET role=\'\',alive=1,act=NULL,vote=NULL,info=\'{}\' WHERE room=?',[$code]);
  q('UPDATE fs_rooms SET status=\'lobby\',phase=\'lobby\',round=0,phase_end=0,winner=\'\',data=\'{}\',upd=NOW() WHERE code=?',[$code]);lg('again',$uid,$code);out(['ok'=>1]);}
 if($a=='room_start'){if(!$host||$r['status']!='lobby')fail('x');if($n<5)fail('تحتاج 5 لاعبين على الأقل');
  $ids=array_column(rows('SELECT id FROM fs_players WHERE room=?',[$code]),'id');shuffle($ids);$roles=array_merge(['mafia','mafia','doctor','elder'],array_fill(0,$n-4,'citizen'));shuffle($roles);
  foreach($ids as $i=>$id)q('UPDATE fs_players SET role=?,alive=1,act=NULL,vote=NULL,info=\'{}\' WHERE id=?',[$roles[$i],$id]);
  q('UPDATE fs_rooms SET status=\'play\',phase=\'night\',round=1,phase_end=?,data=?,upd=NOW() WHERE code=?',[time()+$cf['night'],json_encode(['seq'=>1]),$code]);lg('start',$uid,$code,"n=$n");out(['ok'=>1]);}
 if($a=='leave'){if(in_array($r['status'],['lobby','end'])){q('DELETE FROM fs_players WHERE id=?',[$me['id']]);$nx=row('SELECT id FROM fs_players WHERE room=? ORDER BY id LIMIT 1',[$code]);
   if(!$nx){q('DELETE FROM fs_rooms WHERE code=?',[$code]);q('DELETE FROM fs_chat WHERE room=?',[$code]);}elseif($host)q('UPDATE fs_rooms SET host_pid=? WHERE code=?',[$nx['id'],$code]);}out(['ok'=>1]);}
 if($a=='chat'){$m=mb_substr(trim($in['msg']??''),0,200);if($m===''||($r['status']=='play'&&!$me['alive']))fail('x');
  q('INSERT INTO fs_chat(room,pid,name,msg,ch,ts) VALUES(?,?,?,?,?,?)',[$code,$me['id'],$me['name'],$m,($r['status']=='play'&&$r['phase']=='night'&&$me['role']=='mafia')?'m':'a',time()]);out(['ok'=>1]);}
 if($a=='act'){tick($code);$r=row('SELECT * FROM fs_rooms WHERE code=?',[$code]);$me=row('SELECT * FROM fs_players WHERE id=?',[$me['id']]);
  $tp=row('SELECT * FROM fs_players WHERE id=? AND room=?',[(int)($in['t']??0),$code]);
  if($r['status']!='play'||!$me['alive']||!$tp||!$tp['alive'])fail('x');$res=null;
  if($r['phase']=='night'){$ro=$me['role'];if(!in_array($ro,['mafia','doctor','elder'])||$me['act']!==null)fail('x');
   if($ro=='mafia'&&$tp['role']=='mafia')fail('x');if($ro=='elder'){if($tp['id']==$me['id'])fail('x');$i=json_decode($me['info']?:'{}',true);$i[$tp['id']]=$tp['role']=='mafia'?1:0;q('UPDATE fs_players SET info=? WHERE id=?',[json_encode($i),$me['id']]);$res=['name'=>$tp['name'],'m'=>$i[$tp['id']]];}
   q('UPDATE fs_players SET act=? WHERE id=?',[$tp['id'],$me['id']]);}
  else{if($tp['id']==$me['id'])fail('x');q('UPDATE fs_players SET vote=? WHERE id=?',[$tp['id'],$me['id']]);}
  tick($code);out(['ok'=>1,'res'=>$res]);}
}
fail('?');
}catch(Throwable $e){if(isset($db)&&$db->inTransaction())$db->rollBack();fail('تعذر الاتصال بقاعدة البيانات');}
