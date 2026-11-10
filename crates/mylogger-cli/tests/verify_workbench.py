#!/usr/bin/env python3
"""PTY regression with fake adb only. Run after cargo build --workspace."""
from pathlib import Path
import fcntl, json, os, pty, re, select, signal, struct, sys, tempfile, termios, time
repo=Path(__file__).resolve().parents[3]
work=Path(tempfile.mkdtemp(prefix='workbench-pty-',dir=repo/'tmp'))
adb=work/'adb';adb.write_text((Path(__file__).parent/'fixtures/adb.py').read_text());adb.chmod(0o755)
mode=work/'mode';mode.write_text('two')
env=dict(os.environ,PATH=str(work)+':'+os.environ['PATH'],MYLOGGER_FAKE_ROOT=str(work),XDG_CONFIG_HOME=str(work/'config'),TERM='xterm-256color')
binary=repo/'target/debug/MyLogger'
pid,master=pty.fork()
if pid==0:
    os.chdir(work);os.execve(binary,[str(binary)],env)
fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',38,130,0,0))
transcript=bytearray()
def pump(duration=.15):
    end=time.monotonic()+duration
    while time.monotonic()<end:
        if select.select([master],[],[],max(0,end-time.monotonic()))[0]:
            try:data=os.read(master,65536)
            except OSError:return
            if not data:return
            transcript.extend(data)
            if b'\x1b[6n' in data:os.write(master,b'\x1b[1;1R')
def send(text):os.write(master,text.encode());pump()
def calls():return [json.loads(l) for l in (work/'calls.jsonl').read_text().splitlines()] if (work/'calls.jsonl').exists() else []
def schemas():return [c for c in calls() if len(c)>3 and c[2]=='shell' and "'android.intent.action.VIEW'" in c[3]]
def wait(predicate):
    deadline=time.monotonic()+6
    while not predicate():
        assert time.monotonic()<deadline,'timeout\n'+plain()[-2000:]
        pump(.1)
    pump(.15)
def plain():return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',transcript.decode(errors='replace'))
def command(text):send(text);send('\r');pump(.35)
try:
    pump(.6)
    assert 'ADB 工作台' in plain()
    command('/schema')
    assert not schemas(),calls()
    assert '选择设备' in plain()
    send('\x1b[B');send('\r')
    uri='demo://中文/'+('long-path/'*24)+"?q=it's $HOME&x=1"
    send(uri);send('\x1b[H');send('\x1b[F');send('\r')
    wait(lambda:len(schemas())==1)
    assert schemas()[0][1]=='second' and "'-p'" not in schemas()[0][3]
    # Restoring a schema from history must restore schema mode and use the current target.
    send('\x1b[A');send('\r');wait(lambda:len(schemas())==2)
    send('draft');send('\x1b[A');send('\x1b[B');send('\x1b')
    command('/apps');send('\r');pump(.3);send('com.demo.app');send('\r');pump(.3)
    command('/schema');send('\r');send('demo://favorite');send('\x07');send('\x13')
    send('开发首页');send('\r');pump(.3)
    favorite=work/'config/mylogger/favorites.json';assert favorite.exists()
    assert json.loads(favorite.read_text())[0]['package']=='com.demo.app'
    send('x');send('\x1b')  # Cancel restored draft before opening the collection.
    count=len(schemas());command('/favorites');send('\r');pump(.35);send('\r');pump(.3)
    assert len(schemas())==count,'Favorite must fill before execution'
    send('\r');wait(lambda:len(schemas())==count+1)
    assert "'-p' 'com.demo.app'" in schemas()[-1][3]
    # Cancel picker without executing; then start real background collection through the fake.
    count=len(schemas());command('/schema');send('\x1b');assert len(schemas())==count
    (work/'123.txt').write_text('old capture sentinel')
    command('/log');send('\r');wait(lambda:(work/'logcat.pid').exists())
    log_pid=int((work/'logcat.pid').read_text())
    send('\x10');pump(.3)
    logs=[work/'123.txt'];assert logs[0].exists()
    assert 'old capture sentinel' not in logs[0].read_text()
    assert not list((work/'captures').glob('*.log'))
    before=logs[0].stat().st_size;pump(.4);after=logs[0].stat().st_size
    assert after>before,'Pause display must keep writing the file'
    send('\x03');pump(.5)
    assert str(logs[0]) in plain(), 'Full log path missing from terminal output'
    try:os.kill(log_pid,0)
    except ProcessLookupError:pass
    else:raise AssertionError('Stopped logcat left running')
    with logs[0].open('a') as out: out.write('previous capture sentinel')
    command('/log');send('\r');pump(.4)
    assert 'previous capture sentinel' not in logs[0].read_text()
    log_pid=int((work/'logcat.pid').read_text())
    stream_count=len([c for c in calls() if len(c)>2 and c[2]=='logcat' and '-v' in c])
    command('/logcat');send('\x1b[A');send('\r');pump(.3)
    assert '123.txt 正在被日志任务使用' in plain()
    assert len([c for c in calls() if len(c)>2 and c[2]=='logcat' and '-v' in c])==stream_count
    command('/screenshot');send('\r');pump(.5)
    assert list((work/'captures').glob('*.png'))
    shots=[c for c in calls() if len(c)>2 and c[2]=='exec-out'];assert shots[-1][1]=='first'
    streams=[c for c in calls() if len(c)>2 and c[2]=='logcat' and '-v' in c];assert streams[-1][1]=='second'
    # Ctrl+C also stops background capture while a different task is selected.
    send('\x03');pump(.5)
    try:os.kill(log_pid,0)
    except ProcessLookupError:pass
    else:raise AssertionError('Ctrl+C did not stop background logcat')
    (work/'logcat.pid').unlink()
    command('/logcat');send('\r');wait(lambda:(work/'logcat.pid').exists())
    log_pid=int((work/'logcat.pid').read_text())
    mode.write_text('none');command('/schema');assert '未检测到可用设备' in plain()
    mode.write_text('devices-error');command('/schema');pump(.3)
    # All layouts must continue accepting input after resize.
    for rows,cols in [(20,60),(10,20),(5,8),(38,130)]:
        fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',rows,cols,0,0));os.kill(pid,signal.SIGWINCH);pump(.15)
    command('/quit')
    deadline=time.monotonic()+6
    while True:
        done,status=os.waitpid(pid,os.WNOHANG)
        if done:assert os.waitstatus_to_exitcode(status)==0,status;break
        assert time.monotonic()<deadline,'TUI did not exit';pump(.1)
    try:os.kill(log_pid,0)
    except ProcessLookupError:pass
    else:raise AssertionError('Exit left logcat running')
    assert termios.tcgetattr(master)[3]&termios.ICANON,'Terminal raw mode not restored'
    (work/'result.md').write_text('PASS: workbench header, multi-device-before-schema, long Unicode URI, Home/End/history, app selection, explicit package/favorites fill-before-execute, picker cancel, current-directory 123.txt overwrite and concurrent-writer protection, background logs, pause writes, Ctrl+C stops without quitting, /quit exit cleanup, device/task isolation, screenshots, no-device/error, narrow resize. Fake adb only.\n')
    print('PASS:',work.relative_to(repo))
finally:
    (work/'terminal.log').write_bytes(transcript)
    try:os.kill(pid,signal.SIGTERM);os.waitpid(pid,0)
    except (ProcessLookupError,ChildProcessError):pass
    os.close(master)
