from pathlib import Path
import fcntl, json, os, pty, re, select, signal, struct, tempfile, termios, time
repo=Path.cwd()
work=Path(tempfile.mkdtemp(prefix='push-real-yazi-',dir=repo/'tmp'))
bindir=work/'bin';bindir.mkdir()
adb=bindir/'adb';adb.write_text((repo/'crates/mylogger-cli/tests/fixtures/adb.py').read_text());adb.chmod(0o755)
(work/'mode').write_text('two')
upload=work/'payload-upload.txt';upload.write_text('real yazi selected this file')
env=dict(os.environ,PATH=str(bindir)+':'+os.environ['PATH'],MYLOGGER_FAKE_ROOT=str(work),XDG_CONFIG_HOME=str(work/'config'),TERM='xterm-256color',PWD=str(work))
binary=repo/'target/debug/MyLogger'
pid,master=pty.fork()
if pid==0:
    os.chdir(work);os.execve(binary,[str(binary)],env)
fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',38,130,0,0))
transcript=bytearray()
def pump(duration=.2):
    end=time.monotonic()+duration
    while time.monotonic()<end:
        if select.select([master],[],[],max(0,end-time.monotonic()))[0]:
            try:data=os.read(master,65536)
            except OSError:return
            if not data:return
            transcript.extend(data)
            if b'\x1b[6n' in data:os.write(master,b'\x1b[1;1R')
            if b'\x1b]11;?' in data:os.write(master,b'\x1b]11;rgb:0000/0000/0000\x1b\\')
            if b'\x1bP$q q' in data:os.write(master,b'\x1bP1$r0 q\x1b\\')
def send(text):os.write(master,text.encode());pump()
def plain():return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',transcript.decode(errors='replace'))
try:
    pump(.6);send('/push\r');pump(.5)
    assert '选择设备' in plain()
    assert 'MyLogger 已打开 yazi' not in plain()
    send('\x1b[B');send('\r');pump(2)
    assert 'MyLogger 已打开 yazi' in plain()
    send('f');send('payload-upload');send('\r');pump(.2);send('\r');pump(2)
    assert '/sdcard/doc/' in plain(),'Destination form missing after real yazi selection'
    send('\r');send('\r');pump(.6)
    target=work/'remote/second/sdcard/doc/payload-upload.txt'
    assert target.read_bytes()==upload.read_bytes()
    calls=[json.loads(line) for line in (work/'calls.jsonl').read_text().splitlines()]
    push=[args for args in calls if len(args)>2 and args[2]=='push']
    assert len(push)==1 and push[0][1]=='second'
    send('/push\r');pump(.4);send('\r');pump(2);send('q');pump(1)
    assert '已取消' in plain()
    send('/quit\r');pump(.5)
    done,status=os.waitpid(pid,0);assert os.waitstatus_to_exitcode(status)==0
    assert termios.tcgetattr(master)[3]&termios.ICANON
    (work/'result.md').write_text('PASS: installed real yazi selection and cancellation, multi-device-before-yazi, default destination, terminal restoration. Fake adb only.\n')
    print('PASS:',work.relative_to(repo))
finally:
    (work/'terminal.log').write_bytes(transcript)
    try:os.kill(pid,signal.SIGTERM);os.waitpid(pid,0)
    except (ProcessLookupError,ChildProcessError):pass
    os.close(master)
