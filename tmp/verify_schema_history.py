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

def wait_count(count, schema):
    deadline=time.monotonic()+5
    while len(calls())<count:
        assert time.monotonic()<deadline,calls()
        pump(.1)
    assert calls()[-1]=={'device':'first','schema':schema},calls()
    pump(.4)
try:
    config.write_text('one')
    pump(1)
    baseline=len(calls())
    first='demo://中文?value='+('a'*200)
    menu(); send(first); send('\r')
    wait_count(baseline+1,first)
    send('\x1b[A'); send('\r')
    wait_count(baseline+2,first)
    send('\x1b[A'); send('2'); send('\r')
    wait_count(baseline+3,first+'2')
    send('\x1b[A'); send('\x1b[A'); send('\x1b[B'); send('\r')
    wait_count(baseline+4,first+'2')
    menu()
    send('demo://草稿')
    send('\x1b[A'); send('\x1b[B'); send('\r')
    wait_count(baseline+5,'demo://草稿')
    send('demo://normal-draft')
    send('\x1b[A'); send('\x1b[B'); send('\x1b')
    assert len(calls())==baseline+5
    send('/help '); send('\r')
    send('\x1b[A'); send('\r')
    assert len(calls())==baseline+5
    assert '可用输入' in text()
    config.write_text('two')
    menu()
    send('\x1b[A'); send('\x1b[B'); send('\x1b')
    pump(.4)
    assert len(calls())==baseline+5
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
    (work/'history-terminal.log').write_bytes(transcript)
    try: os.kill(pid,signal.SIGTERM); os.waitpid(pid,0)
    except (ProcessLookupError,ChildProcessError): pass
    os.close(master)
(work/'history-result.md').write_text('PASS: PTY history recall immediately after schema execution, edit/reexecute, up/down traversal, schema draft restore, ordinary draft restore and help command replay, long Chinese input, device-picker arrows unchanged. Fake adb only.\n')
print('Passed history PTY checks:',work.relative_to(root))
