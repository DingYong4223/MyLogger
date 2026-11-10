from pathlib import Path
import re, os, json, pty, fcntl, termios, struct, select, time, signal
root = Path.cwd()
work = sorted((root/'tmp').glob('open-schema-check-*'), key=lambda p:p.stat().st_mtime)[-1]
log = work/'adb-calls.jsonl'
env = dict(os.environ, PATH=str(work)+os.pathsep+os.environ['PATH'], MYLOGGER_SCHEMA_TEST_LOG=str(log), TERM='xterm-256color')
def calls():
    return [json.loads(line)['schema'] for line in log.read_text().splitlines()]
before = len(calls())
binary = str(root/'target/debug/MyLogger')
pid, master = pty.fork()
if pid == 0:
    os.execve(binary, [binary], env)
fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 150, 0, 0))
transcript = bytearray()
def pump(duration=0.25):
    end = time.monotonic()+duration
    while time.monotonic() < end:
        if select.select([master], [], [], max(0,end-time.monotonic()))[0]:
            try:
                data = os.read(master,65536)
            except OSError:
                return
            if not data:
                return
            transcript.extend(data)
            if b'\x1b[6n' in data:
                os.write(master,b'\x1b[1;1R')
def send(text):
    os.write(master,text.encode())
    pump()
def wait_call(count, schema):
    deadline = time.monotonic()+5
    while len(calls()) < count:
        assert time.monotonic() < deadline, ('adb not called',calls())
        pump(0.1)
    assert calls()[-1] == schema, calls()
    pump(0.5)
def open_menu():
    send('/')
    for _ in range(4):
        send('\x1b[B')
    send('\r')
schema = 'demo://中文 path?a=1&b=it\'s "quoted" $(echo injection)`echo injection`' * 10
try:
    pump(1)
    open_menu()
    send('\r')
    assert len(calls()) == before
    send(schema)
    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', 50, 80, 0, 0))
    os.kill(pid, signal.SIGWINCH)
    pump(0.3)
    send('\x1b[H')
    send('\x1b[C')
    send('\x1b[F')
    send('\x7f')
    send(schema[-1])
    send('\r')
    wait_call(before+1,schema)
    open_menu()
    send('\x1b')
    pump(0.5)
    assert len(calls()) == before+1
    open_menu()
    send('demo://fail-am')
    send('\r')
    wait_call(before+2,'demo://fail-am')
    open_menu()
    send('/quit')
    send('\r')
    wait_call(before+3,'/quit')
    send('\x03')
    deadline = time.monotonic()+3
    while True:
        waited,status = os.waitpid(pid,os.WNOHANG)
        if waited:
            assert os.waitstatus_to_exitcode(status) == 0,status
            break
        assert time.monotonic() < deadline,'process did not exit'
        pump(0.05)
        time.sleep(0.01)
    output = re.sub(r'\[[0-?]*[ -/]*[@-~]', '', transcript.decode(errors='replace'))
    assert '不能为空' in output and '执行失败' in output and '已取消' in output
finally:
    (work/'scroll-terminal.log').write_bytes(transcript)
    try:
        os.kill(pid,signal.SIGTERM)
        os.waitpid(pid,0)
    except (ProcessLookupError,ChildProcessError):
        pass
    os.close(master)
(work/'scroll-result.md').write_text('通过：逐行模式及PTY终端菜单选择、空输入、特殊字符原样传递、Esc/EOF取消、非零退出、am零退出错误、Status timeout、失败后继续操作、/quit作为schema、正常退出。仅替身adb；未连接设备。\n')
print('Passed long-schema PTY navigation, editing, resize and submission:',work.relative_to(root))
