from pathlib import Path
import os, sys, json, tempfile, subprocess, pty, fcntl, termios, struct, select, time, signal, re
root=Path.cwd()
work=Path(tempfile.mkdtemp(prefix='schema-devices-',dir=root/'tmp'))
config=work/'mode'
log=work/'calls.jsonl'
stub=work/'adb'
stub.write_text('#!'+sys.executable+'''
import os,sys,json,shlex
from pathlib import Path
args=sys.argv[1:]
mode=Path(os.environ['MYLOGGER_DEVICES_MODE']).read_text()
if args == ['devices']:
    if mode == 'error':
        print('device list failed',file=sys.stderr)
        sys.exit(1)
    print('List of devices attached')
    if mode != 'none': print('first\\tdevice')
    if mode == 'two': print('second\\tdevice')
    print('locked\\tunauthorized')
    print('lost\\toffline')
else:
    assert args[:1] == ['-s'] and args[2] == 'shell',args
    parts=shlex.split(args[3])
    assert parts[:6] == ['am','start','-W','-a','android.intent.action.VIEW','-d']
    with open(os.environ['MYLOGGER_DEVICES_LOG'],'a') as out:
        out.write(json.dumps({'device':args[1],'schema':parts[6]})+'\\n')
    print('Status: ok')
''')
stub.chmod(0o755)
env=dict(os.environ,PATH=str(work)+os.pathsep+os.environ['PATH'],MYLOGGER_DEVICES_MODE=str(config),MYLOGGER_DEVICES_LOG=str(log),TERM='xterm-256color')
binary=str(root/'target/debug/MyLogger')
def calls(): return [json.loads(line) for line in log.read_text().splitlines()] if log.exists() else []
config.write_text('two')
result=subprocess.run([binary],input='/打开schema\n2\ndemo://line\n/quit\n',text=True,capture_output=True,env=env,timeout=10)
assert result.returncode==0 and calls()[-1]=={'device':'second','schema':'demo://line'},result
assert result.stdout.index('请选择要操作的设备')<result.stdout.index('请输入schema')
config.write_text('one')
result=subprocess.run([binary],input='/打开schema\ndemo://single\n/quit\n',text=True,capture_output=True,env=env,timeout=10)
assert calls()[-1]=={'device':'first','schema':'demo://single'}
config.write_text('none')
result=subprocess.run([binary],input='/打开schema\n/help\n/quit\n',text=True,capture_output=True,env=env,timeout=10)
assert '请输入schema' not in result.stdout and '可用输入' in result.stdout
config.write_text('two')
pid,master=pty.fork()
if pid==0: os.execve(binary,[binary],env)
fcntl.ioctl(master,termios.TIOCSWINSZ,struct.pack('HHHH',50,150,0,0))
transcript=bytearray()
def pump(duration=.25):
    end=time.monotonic()+duration
    while time.monotonic()<end:
        if select.select([master],[],[],max(0,end-time.monotonic()))[0]:
            try: data=os.read(master,65536)
            except OSError: return
            if not data: return
            transcript.extend(data)
            if b'\x1b[6n' in data: os.write(master,b'\x1b[1;1R')
def send(text): os.write(master,text.encode()); pump()
def menu(index=4):
    send('/')
    for _ in range(index): send('\x1b[B')
    send('\r'); pump(.4)
def text(): return re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',transcript.decode(errors='replace'))
def wait_call(expected):
    end=time.monotonic()+5
    while not calls() or calls()[-1]!=expected:
        assert time.monotonic()<end,calls()
        pump(.1)
    pump(.5)
try:
    pump(1)
    menu()
    assert 'first' in text() and 'second' in text() and '请输入schema' not in text()
    assert 'locked' not in text() and 'lost' not in text()
    send('\x1b[B'); send('\r')
    assert '请输入schema' in text()
    send('demo://second?text=中文&foo=bar'); send('\r')
    wait_call({'device':'second','schema':'demo://second?text=中文&foo=bar'})
    count=len(calls())
    menu(); send('\x1b'); pump(.3)
    assert len(calls())==count
    menu(); send('\r'); send('demo://first'); send('\r')
    wait_call({'device':'first','schema':'demo://first'})
    menu(2)
    assert '开始抓取' in text()
    send('\x1b'); pump(.3)
    config.write_text('none'); menu()
    assert '未检测到可用' in text()
    config.write_text('error'); menu()
    assert '读取设备失败' in text()
    config.write_text('one'); menu(); send('demo://only'); send('\r')
    wait_call({'device':'first','schema':'demo://only'})
    send('\x03')
    deadline=time.monotonic()+3
    while True:
        waited,status=os.waitpid(pid,os.WNOHANG)
        if waited:
            assert os.waitstatus_to_exitcode(status)==0
            break
        assert time.monotonic()<deadline
        pump(.05); time.sleep(.01)
finally:
    (work/'terminal.log').write_bytes(transcript)
    try: os.kill(pid,signal.SIGTERM); os.waitpid(pid,0)
    except (ProcessLookupError,ChildProcessError): pass
    os.close(master)
(work/'result.md').write_text('PASS: line and PTY device selection before schema input; -s selected device; repick with previous selection; cancel; one/zero devices; offline/unauthorized excluded; list error recovery; capture picker cancel. Fake adb only.\n')
print('Passed device flow checks:',work.relative_to(root))
