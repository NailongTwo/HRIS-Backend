const { execSync } = require('child_process');

function killGhosts() {
  const myPid = process.pid;
  const parentPid = process.ppid;
  
  // Safe PIDs we must not kill:
  // - Current process (myPid)
  // - Parent process (parentPid)
  // - Active backend server (15200)
  // - Active Vite dev server (3412)
  const safePids = new Set([myPid, parentPid, 15200, 3412]);
  
  console.log("Safe PIDs:", Array.from(safePids));
  
  try {
    // Get all running node processes using tasklist
    const output = execSync('tasklist /FI "IMAGENAME eq node.exe" /FO CSV /NH').toString();
    
    // Parse CSV output
    const lines = output.split('\n');
    const processes = [];
    
    for (const line of lines) {
      if (!line.trim()) continue;
      // line is like: "node.exe","15200","Console","5","1,888 K"
      const parts = line.split(',').map(p => p.replace(/"/g, '').trim());
      const pid = parseInt(parts[1]);
      if (pid) {
        processes.push(pid);
      }
    }
    
    console.log("Found node PIDs:", processes);
    
    let killedCount = 0;
    for (const pid of processes) {
      if (safePids.has(pid)) {
        console.log(`Skipping safe process PID: ${pid}`);
        continue;
      }
      
      try {
        console.log(`Killing ghost process PID: ${pid}...`);
        execSync(`taskkill /F /PID ${pid}`);
        killedCount++;
      } catch (err) {
        console.error(`Failed to kill PID ${pid}:`, err.message);
      }
    }
    
    console.log(`Successfully killed ${killedCount} ghost node processes.`);
  } catch (err) {
    console.error("Error running killGhosts:", err.message);
  }
}

killGhosts();
